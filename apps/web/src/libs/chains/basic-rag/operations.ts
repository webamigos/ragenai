import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { SourceRegion } from '@ragenai/rag-core';
import type { ModelMessage } from 'ai';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import type {
  VectorStoreClient,
  VectorStoreDocument,
} from '@/libs/vector-store/types';
import type { EmbeddingsProvider } from '@/libs/llm/types/embeddings';
import type {
  RetrievedSource,
  BaseChatChainInput,
  ChainTrackingContext,
} from '../types/common';
import type { ThreadDocumentUI } from '@/features/documents/contracts/document.types';
import { AiUsageStep } from '@/generated/prisma/client';
import { trackAiUsage } from '@/features/ai-usage/services/commands/create-ai-usage-command';
import {
  combineDocuments,
  buildUserMessageWithImages,
} from '../utils/chain-utils';
import {
  DEFAULT_ANSWER_INSTRUCTIONS,
  humanTemplates,
  systemTemplates,
} from './config';
import { ThreadDocumentRetriever } from '../utils/ThreadDocumentRetriever';
import { rerankDocuments, isRerankingEnabled } from '@/libs/reranker';
import { logger } from '@/app/lib/utils/logger';
import { withSpan } from '@/libs/monitoring/with-span';

type Message = {
  type: 'user' | 'assistant';
  content: string;
};

/** Multiplier for initial retrieval count when reranking is enabled. */
const RERANK_RETRIEVAL_MULTIPLIER = 3;

/**
 * Number of alternate phrasings to generate per turn. The total number of
 * queries issued to the vector store is this value + 1 (the original
 * standalone question is always included as the first query).
 */
export const MULTI_QUERY_VARIANT_COUNT = 1;

const expandQueriesSchema = z.object({
  variants: z
    .array(z.string())
    .describe('Alternative phrasings of the input question'),
});

const rephraseAndExpandSchema = z.object({
  standaloneQuestion: z
    .string()
    .describe(
      'The rephrased standalone question that captures the full intent without depending on chat history',
    ),
  variants: z
    .array(z.string())
    .describe('Alternative phrasings of the standalone question'),
});

/**
 * Fire-and-forget AiUsage record for a non-chat LLM call (rephrase / expand).
 * Errors are swallowed — broken telemetry must never sink a user-facing turn.
 */
function recordRephraseUsage(
  model: LanguageModelV3,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  durationMs: number,
  tracking: ChainTrackingContext,
): void {
  if (!usage) {
    return;
  }
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  void trackAiUsage({
    organizationId: tracking.organizationId,
    projectId: tracking.projectId ?? null,
    userId: tracking.userId ?? null,
    step: AiUsageStep.REPHRASING,
    provider: 'litellm',
    model: model.modelId,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    durationMs,
  }).catch(() => undefined);
}

function formatChatHistory(chatHistory: string): Message[] {
  const lines = chatHistory.split('\n').filter((line) => line.trim());
  const messages: Message[] = [];

  lines.forEach((line) => {
    if (line.startsWith('USER: ')) {
      messages.push({
        type: 'user',
        content: line.replace('USER: ', '').trim(),
      });
    } else if (line.startsWith('ASSISTANT: ')) {
      messages.push({
        type: 'assistant',
        content: line.replace('ASSISTANT: ', '').trim(),
      });
    }
  });

  return messages;
}

export async function rephraseQuestion(
  model: LanguageModelV3,
  input: BaseChatChainInput,
  tracking?: ChainTrackingContext,
): Promise<string> {
  if (!model) {
    throw new Error('Error rephrasing question: No model instance');
  }

  const messages: ModelMessage[] = [];

  if (input.chat_history) {
    const formattedHistory = formatChatHistory(input.chat_history);
    for (const msg of formattedHistory) {
      messages.push({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }
  }

  const humanMessage = humanTemplates.rephraseQuestion.replace(
    '{question}',
    input.question,
  );
  messages.push({ role: 'user', content: humanMessage });

  const startMs = Date.now();
  const result = await generateText({
    model,
    system: systemTemplates.rephraseQuestion,
    messages,
    experimental_telemetry: {
      isEnabled: true,
      functionId: 'rephrase-question',
    },
  });
  if (tracking) {
    recordRephraseUsage(model, result.usage, Date.now() - startMs, tracking);
  }

  return result.text;
}

/**
 * Generate alternative phrasings of a standalone question for multi-query
 * retrieval. Uses structured output (Zod schema) so a malformed response
 * raises an error rather than returning invalid data.
 *
 * On any failure (LLM error, invalid structured output, empty array after
 * filtering), returns an empty array and lets the caller fall back to
 * single-query retrieval. The expansion step must never regress behavior.
 */
export async function expandQueries(
  model: LanguageModelV3,
  standaloneQuestion: string,
  variantCount: number = MULTI_QUERY_VARIANT_COUNT,
  tracking?: ChainTrackingContext,
): Promise<string[]> {
  if (!model) {
    throw new Error('Error expanding queries: No model instance');
  }

  const humanMessage = humanTemplates.expandQueries
    .replace('{count}', String(variantCount))
    .replace('{question}', standaloneQuestion);

  try {
    const startMs = Date.now();
    const result = await generateObject({
      model,
      schema: expandQueriesSchema,
      system: systemTemplates.expandQueries,
      messages: [{ role: 'user', content: humanMessage }],
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'expand-queries',
      },
    });
    if (tracking) {
      recordRephraseUsage(model, result.usage, Date.now() - startMs, tracking);
    }

    // Defensive cleanup of LLM output:
    // 1. trim whitespace
    // 2. drop empty strings
    // 3. drop variants that are identical to the original standalone question
    //    (case-insensitive — LLMs sometimes regurgitate the input)
    // 4. dedupe by normalized form so the fan-out does not run duplicate searches
    // 5. cap at variantCount so the model cannot exceed its instructed budget
    const standaloneNormalized = standaloneQuestion.trim().toLowerCase();
    const seen = new Set<string>();
    const variants: string[] = [];
    for (const raw of result.object.variants) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const normalized = trimmed.toLowerCase();
      if (normalized === standaloneNormalized) {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      variants.push(trimmed);
      if (variants.length >= variantCount) {
        break;
      }
    }

    // Log non-sensitive diagnostics only — never log raw user text (PII).
    logger.debug(
      {
        variantCount: variants.length,
        requestedCount: variantCount,
        standaloneQuestionLength: standaloneQuestion.length,
      },
      'Generated query variants for multi-query retrieval',
    );

    return variants;
  } catch (err) {
    // Graceful degradation: any failure falls back to single-query retrieval.
    // Log the error type but NOT the raw question (PII).
    logger.warn(
      { err, standaloneQuestionLength: standaloneQuestion.length },
      'Query expansion failed, falling back to single query',
    );
    return [];
  }
}

/**
 * Combined rephrase + query expansion in a single LLM call.
 *
 * Produces a standalone question from the chat history AND generates alternative
 * phrasings for multi-query retrieval — saving one full LLM round-trip compared
 * to calling rephraseQuestion() then expandQueries() sequentially.
 *
 * When `expandVariants` is false, the variants array is always empty (skips
 * multi-query entirely while still saving the separate rephrase call).
 *
 * Falls back to just the rephrased standalone question (no variants) on any
 * structured-output error — the expansion step must never regress behavior.
 */
export async function rephraseAndExpand(
  model: LanguageModelV3,
  input: BaseChatChainInput,
  expandVariants = true,
  variantCount: number = MULTI_QUERY_VARIANT_COUNT,
  tracking?: ChainTrackingContext,
): Promise<{ standaloneQuestion: string; variants: string[] }> {
  if (!model) {
    throw new Error('Error rephrasing question: No model instance');
  }

  const messages: ModelMessage[] = [];

  if (input.chat_history) {
    const formattedHistory = formatChatHistory(input.chat_history);
    for (const msg of formattedHistory) {
      messages.push({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }
  }

  const expansionInstruction = expandVariants
    ? `Then generate exactly ${variantCount} alternative phrasing(s) of that standalone question using different vocabulary, synonyms, or a different level of abstraction. Each alternative must be a complete, standalone question. Do not include the standalone question itself in the variants array.`
    : 'Set variants to an empty array.';

  const humanMessage = `Rephrase the following question as a standalone question that captures the full intent without depending on chat history. ${expansionInstruction} Respond in the same language as the input question.\n\nQuestion: ${input.question}`;
  messages.push({ role: 'user', content: humanMessage });

  try {
    const startMs = Date.now();
    const result = await generateObject({
      model,
      schema: rephraseAndExpandSchema,
      system: systemTemplates.rephraseAndExpand,
      messages,
      experimental_telemetry: {
        isEnabled: true,
        functionId: 'rephrase-and-expand',
      },
    });
    if (tracking) {
      recordRephraseUsage(model, result.usage, Date.now() - startMs, tracking);
    }

    const standaloneQuestion = result.object.standaloneQuestion.trim();
    if (standaloneQuestion.length === 0) {
      // If the model returns empty, fall back to the raw input question.
      return { standaloneQuestion: input.question, variants: [] };
    }

    if (!expandVariants) {
      return { standaloneQuestion, variants: [] };
    }

    // Defensive cleanup — same as expandQueries():
    const standaloneNormalized = standaloneQuestion.toLowerCase();
    const seen = new Set<string>();
    const variants: string[] = [];
    for (const raw of result.object.variants) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        continue;
      }
      const normalized = trimmed.toLowerCase();
      if (normalized === standaloneNormalized) {
        continue;
      }
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      variants.push(trimmed);
      if (variants.length >= variantCount) {
        break;
      }
    }

    logger.debug(
      {
        variantCount: variants.length,
        requestedCount: variantCount,
        standaloneQuestionLength: standaloneQuestion.length,
      },
      'Rephrase + expand completed in single LLM call',
    );

    return { standaloneQuestion, variants };
  } catch (err) {
    // Graceful degradation: if structured output fails, fall back to input question with no variants.
    logger.warn(
      { err, questionLength: input.question.length },
      'Rephrase-and-expand failed, falling back to raw input question',
    );
    return { standaloneQuestion: input.question, variants: [] };
  }
}

/**
 * Retrieve relevant documents from the vector store with optional reranking.
 * Supports both single-query and multi-query retrieval.
 *
 * When multiple queries are provided:
 * 1. Fan out vector search in parallel (one per query)
 * 2. Deduplicate candidates by content string (first occurrence wins)
 * 3. Rerank the deduplicated pool to top-k
 *
 * Per-query retrieval count is divided by the number of queries so the
 * total pre-dedupe candidate pool stays roughly the same as single-query
 * behavior. This keeps the reranker input size bounded.
 *
 * When reranking is disabled (local dev without Bedrock), skips the rerank
 * step and returns the first `maxDocuments` deduplicated results.
 */
export async function retrieveRelevantDocuments(
  vectorStore: VectorStoreClient,
  queries: string | string[],
  maxDocuments = 4,
  metadataFilter?: object,
  litellmApiKey?: string,
  rerankingEnabled = true,
  tracking?: {
    organizationId?: string | null;
    userId?: string | null;
    projectId?: string | null;
  },
): Promise<string> {
  if (!vectorStore) {
    throw new Error('Error retrieving relevant documents: No vector store');
  }

  const queryList = Array.isArray(queries) ? queries : [queries];
  if (queryList.length === 0) {
    return combineDocuments([]);
  }

  const filter =
    metadataFilter && Object.keys(metadataFilter).length > 0
      ? metadataFilter
      : undefined;

  const useReranking = rerankingEnabled && isRerankingEnabled();
  const totalPoolTarget = useReranking
    ? maxDocuments * RERANK_RETRIEVAL_MULTIPLIER
    : maxDocuments;
  // Divide the pool target across queries, floored at maxDocuments so every
  // branch returns at least enough results to matter.
  const perQueryCount = Math.max(
    maxDocuments,
    Math.floor(totalPoolTarget / queryList.length),
  );

  const resultsPerQuery = await Promise.all(
    queryList.map((q) =>
      vectorStore.similaritySearch(q, perQueryCount, filter),
    ),
  );

  // Dedupe by pageContent — chunks identical in content are the same document
  // even if retrieved by different query variants.
  const deduped = new Map<string, VectorStoreDocument>();
  for (const docs of resultsPerQuery) {
    for (const doc of docs) {
      if (!deduped.has(doc.pageContent)) {
        deduped.set(doc.pageContent, doc);
      }
    }
  }
  const uniqueDocs = Array.from(deduped.values());

  if (useReranking && uniqueDocs.length > maxDocuments) {
    // Rerank using the first (primary) query — it is the original standalone
    // phrasing, which is the most faithful representation of user intent.
    const reranked = await rerankDocuments(queryList[0], uniqueDocs, {
      topN: maxDocuments,
      litellmApiKey,
      tracking,
    });
    return combineDocuments(reranked);
  }

  return combineDocuments(uniqueDocs.slice(0, maxDocuments));
}

/**
 * Same as {@link retrieveRelevantDocuments} but also returns which files the
 * final chunks came from: `fileIds` for the telemetry that already counts
 * them, and `sources` (id plus the `file_name` the chunk was rendered with)
 * for `ChainStreamResult.retrievedSources`.
 *
 * These are the files the model was *shown*. Which of them it *cited* is
 * decided after the answer exists — `features/documents/utils/cited-sources.ts`
 * — never here.
 */
/**
 * A ceiling on a stored quote, not a target length.
 *
 * The snippet is persisted per turn and encrypted, so it duplicates document
 * text at the rate answers are produced. Chunk size is configurable per
 * organization, so there is no single correct length — this bounds the worst
 * case without truncating an ordinary chunk.
 */
const SNIPPET_MAX_CHARS = 2000;

/**
 * Cuts a snippet to the ceiling without splitting a character in half.
 *
 * `slice` counts UTF-16 code units, and anything outside the BMP — an emoji,
 * some CJK extensions, a mathematical symbol — is two of them. Cutting between
 * the pair leaves an unpaired high surrogate: a string that is no longer valid
 * UTF-16, survives JSON round-trips as U+FFFD, and renders as a replacement
 * glyph in the quote.
 */
function truncateSnippet(text: string): string {
  if (text.length <= SNIPPET_MAX_CHARS) {
    return text;
  }
  const cut = text.slice(0, SNIPPET_MAX_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  // A high surrogate at the very end has lost its partner to the cut.
  const endsMidCharacter = last >= 0xd800 && last <= 0xdbff;
  return endsMidCharacter ? cut.slice(0, -1) : cut;
}

/**
 * Reads `source_regions` off a Qdrant payload, dropping anything malformed.
 *
 * Validated rather than cast. The payload is schemaless and the value comes
 * back as whatever some version of the worker wrote, so a single bad entry
 * would otherwise reach a viewer as `left: NaN%` — a rectangle at no position,
 * on a page it cannot be traced back to. Coordinates outside 0–1 are dropped
 * for the same reason: the contract is a fraction of the page box, and a value
 * that is not one is not a box that was drawn wrong, it is one that was never
 * a box.
 */
function readSourceRegions(value: unknown): SourceRegion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const regions: SourceRegion[] = [];
  for (const entry of value) {
    const region = entry as Partial<SourceRegion> | null;
    if (!region || typeof region !== 'object') {
      continue;
    }
    const { page, x, y, w, h } = region;
    if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
      continue;
    }
    const inUnitRange = (n: unknown): n is number =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
    // Checked one at a time rather than with `every`: a type predicate on an
    // array narrows the array, not the destructured values, and the arithmetic
    // below needs them to be numbers. Narrowing here is also what lets the
    // push be a plain object instead of an `as SourceRegion` cast — the cast
    // was quietly asserting exactly what this validates.
    if (
      !inUnitRange(x) ||
      !inUnitRange(y) ||
      !inUnitRange(w) ||
      !inUnitRange(h)
    ) {
      continue;
    }
    // And the box has to *fit* on the page, not merely start and measure
    // inside it. `x: 0.9, w: 0.9` passes every check above and draws a
    // rectangle running off the right edge. The worker clamps width and
    // height against the origin so it never writes one, but this reads back
    // whatever some version of it wrote.
    //
    // The tolerance is for float addition, not for slack: `0.0271 + 0.9729`
    // is exactly 1 here, but a sum of two decimals is not guaranteed to be,
    // and a full-width box rejected by one ulp would be a worse bug than the
    // one this prevents.
    const FITS_TOLERANCE = 1e-6;
    if (x + w > 1 + FITS_TOLERANCE || y + h > 1 + FITS_TOLERANCE) {
      continue;
    }
    regions.push({ page, x, y, w, h });
  }
  return regions;
}

export async function retrieveRelevantDocumentsWithIds(
  vectorStore: VectorStoreClient,
  queries: string | string[],
  maxDocuments = 4,
  metadataFilter?: object,
  litellmApiKey?: string,
  rerankingEnabled = true,
  tracking?: {
    organizationId?: string | null;
    userId?: string | null;
    projectId?: string | null;
  },
): Promise<{
  context: string;
  fileIds: string[];
  sources: RetrievedSource[];
  /** Chunks actually placed in front of the model, after dedupe and rerank. */
  chunkCount: number;
  /** Wall-clock for the whole stage: fan-out, dedupe and rerank together. */
  durationMs: number;
}> {
  if (!vectorStore) {
    throw new Error('Error retrieving relevant documents: No vector store');
  }

  const startedAt = Date.now();
  const queryList = Array.isArray(queries) ? queries : [queries];
  if (queryList.length === 0) {
    return {
      context: combineDocuments([]),
      fileIds: [],
      sources: [],
      chunkCount: 0,
      durationMs: 0,
    };
  }

  const filter =
    metadataFilter && Object.keys(metadataFilter).length > 0
      ? metadataFilter
      : undefined;

  const useReranking = rerankingEnabled && isRerankingEnabled();
  const totalPoolTarget = useReranking
    ? maxDocuments * RERANK_RETRIEVAL_MULTIPLIER
    : maxDocuments;
  const perQueryCount = Math.max(
    maxDocuments,
    Math.floor(totalPoolTarget / queryList.length),
  );

  // The retrieval stage is the part of the pipeline with no telemetry of its
  // own: the LLM calls around it are already covered by the AI SDK's
  // experimental_telemetry, but the fan-out/dedupe/rerank work in between was
  // invisible. Child spans sit inside the stages rather than around the
  // Promise.all, so the parallel searches still read as parallel.
  return withSpan(
    'rag.retrieve',
    {
      'rag.query_count': queryList.length,
      'rag.max_documents': maxDocuments,
      'rag.per_query_count': perQueryCount,
      'rag.reranking_enabled': useReranking,
    },
    async (span) => {
      const resultsPerQuery = await Promise.all(
        queryList.map((q) =>
          vectorStore.similaritySearch(q, perQueryCount, filter),
        ),
      );

      const deduped = new Map<string, VectorStoreDocument>();
      for (const docs of resultsPerQuery) {
        for (const doc of docs) {
          if (!deduped.has(doc.pageContent)) {
            deduped.set(doc.pageContent, doc);
          }
        }
      }
      const uniqueDocs = Array.from(deduped.values());

      const retrievedCount = resultsPerQuery.reduce(
        (sum, docs) => sum + docs.length,
        0,
      );
      span.setAttribute('rag.retrieved_count', retrievedCount);
      span.setAttribute('rag.deduped_count', uniqueDocs.length);

      let finalDocs: VectorStoreDocument[];
      if (useReranking && uniqueDocs.length > maxDocuments) {
        finalDocs = await withSpan(
          'rag.rerank',
          { 'rag.rerank_input_count': uniqueDocs.length },
          async () =>
            rerankDocuments(queryList[0], uniqueDocs, {
              topN: maxDocuments,
              litellmApiKey,
              tracking,
            }),
        );
      } else {
        finalDocs = uniqueDocs.slice(0, maxDocuments);
      }

      const seenFileIds = new Set<string>();
      const sources: RetrievedSource[] = [];
      // What the dedupe used to drop. The loop below keeps one chunk per file
      // and discards the rest, so "six chunks of this document, from pages 2,
      // 4 and 9" was computed and thrown away on every turn — the same shape
      // of loss as `relevance_score` before it was plumbed through. Counting
      // here costs a Map write per chunk and is unrecoverable afterwards.
      const chunkCountByFile = new Map<string, number>();
      const pagesByFile = new Map<string, Set<number>>();

      for (const doc of finalDocs) {
        const fileId = doc.metadata?.file_id;
        if (typeof fileId !== 'string' || fileId.length === 0) {
          // A chunk with no file id belongs to no source and is counted
          // against none. It still counts toward the turn's `chunkCount`,
          // which is why the per-file counts can sum to less than it.
          continue;
        }

        chunkCountByFile.set(fileId, (chunkCountByFile.get(fileId) ?? 0) + 1);

        const chunkPage = doc.metadata?.source_page;
        if (
          typeof chunkPage === 'number' &&
          Number.isInteger(chunkPage) &&
          chunkPage >= 1
        ) {
          const pages = pagesByFile.get(fileId) ?? new Set<number>();
          pages.add(chunkPage);
          pagesByFile.set(fileId, pages);
        }

        if (!seenFileIds.has(fileId)) {
          seenFileIds.add(fileId);
          const fileName = doc.metadata?.file_name;
          // `finalDocs` is in rank order and this is the first chunk seen for
          // the file, so its score is the file's best — which is what a
          // per-document bar should show. Absent whenever reranking did not
          // run, which is the default installation.
          const relevanceScore = doc.metadata?.relevance_score;
          // The quote comes from the same chunk as the score, because they
          // describe the same thing. Capped rather than sized to the chunk:
          // chunk size is a per-org setting, so there is no fixed length to
          // match — this bounds the pathological case, and an ordinary chunk
          // sits well under it.
          const snippet = truncateSnippet(doc.pageContent.trim());
          // The page of *this* chunk, which is the best-ranked one for the
          // file — the same chunk the score and the quote come from, so all
          // three describe one place in one document rather than three.
          //
          // `source_page`, never the older `page_number`: that one held the
          // chunk index and produced "page 37" for a twelve-page PDF. Guarded
          // rather than cast, because the value comes back from Qdrant as
          // whatever was written years ago.
          const sourcePage = doc.metadata?.source_page;
          const hasSourcePage =
            typeof sourcePage === 'number' &&
            Number.isInteger(sourcePage) &&
            sourcePage >= 1;
          // And where on that page it sits. Same chunk again, for the same
          // reason: a rectangle drawn from one chunk under a quote taken from
          // another would point at the wrong paragraph. Validated rather than
          // cast — this comes back from Qdrant as whatever was written, and a
          // malformed entry would place a box at NaN% of the page.
          const sourceRegions = readSourceRegions(doc.metadata?.source_regions);
          sources.push({
            fileId,
            fileName:
              typeof fileName === 'string' && fileName.length > 0
                ? fileName
                : null,
            // Filled in below, once every chunk has been seen. A count taken
            // here would always be 1 — this is the file's first chunk.
            chunkCount: 0,
            ...(typeof relevanceScore === 'number' ? { relevanceScore } : {}),
            ...(hasSourcePage ? { sourcePage } : {}),
            ...(sourceRegions.length > 0 ? { sourceRegions } : {}),
            ...(snippet.length > 0 ? { snippet } : {}),
          });
        }
      }

      for (const source of sources) {
        // At least 1: the file is in `sources` because a chunk of it is, so
        // the Map always has an entry. The fallback is for the type, not for a
        // case that can happen.
        source.chunkCount = chunkCountByFile.get(source.fileId) ?? 1;
        const pages = pagesByFile.get(source.fileId);
        // Absent, not empty. An empty array would say "came from no pages";
        // absence says the parser could not tell us, which is the truth for
        // every legacy loader and every unpaginated format.
        if (pages && pages.size > 0) {
          source.pages = [...pages].sort((a, b) => a - b);
        }
      }

      const fileIds = sources.map((source) => source.fileId);

      // `sources` is already deduped by file and in rank order, so its index
      // is the number the answer cites — `[1]` is the best-ranked document.
      // Built here rather than in the renderer because this is the only place
      // that knows the final, deduped, reranked order.
      const sourceNumbers = new Map(
        sources.map((source, index) => [source.fileId, index + 1]),
      );

      span.setAttribute('rag.final_count', finalDocs.length);
      span.setAttribute('rag.file_count', fileIds.length);

      // `chunkCount` is the count of chunks, `sources.length` the count of
      // files they came from — the two differ whenever one document supplies
      // more than one chunk, which is the normal case. The retrieval row shows
      // both, so neither can be derived from the other.
      return {
        context: combineDocuments(finalDocs, sourceNumbers),
        fileIds,
        sources,
        chunkCount: finalDocs.length,
        durationMs: Date.now() - startedAt,
      };
    },
  );
}

export async function retrieveThreadDocuments(
  threadDocuments: ThreadDocumentUI[],
  vectorStore: VectorStoreClient,
  embeddings: EmbeddingsProvider,
  standaloneQuestion: string,
  maxChunks: number = 3,
): Promise<string> {
  if (!threadDocuments || threadDocuments.length === 0) {
    return '[Brak dokumentow watku - uzytkownik nie wgral zadnych plikow]';
  }

  const retriever = new ThreadDocumentRetriever(vectorStore, embeddings);
  const relevantChunks = await retriever.retrieveRelevantChunks(
    threadDocuments,
    standaloneQuestion,
    maxChunks,
  );

  return combineDocuments(relevantChunks);
}

export function buildRagMessages(
  standaloneQuestion: string,
  chatHistory: string | undefined,
  context: string,
  threadContext: string,
  answerInstructions?: string | null,
  projectInstructions?: string,
  imageDocuments?: ThreadDocumentUI[],
): { system: string; messages: ModelMessage[] } {
  const effectiveAnswerInstructions =
    answerInstructions || DEFAULT_ANSWER_INSTRUCTIONS;
  const effectiveProjectInstructions = projectInstructions || '';

  const systemMessage = systemTemplates.answerChain
    .replace('{answer_instructions}', effectiveAnswerInstructions)
    .replace('{project_instructions}', effectiveProjectInstructions)
    .replace('{context}', context)
    .replace('{thread_context}', threadContext);

  const messages: ModelMessage[] = [];

  if (chatHistory) {
    const formattedHistory = formatChatHistory(chatHistory);
    for (const msg of formattedHistory) {
      messages.push({
        role: msg.type === 'user' ? 'user' : 'assistant',
        content: msg.content,
      });
    }
  }

  const humanMessage = humanTemplates.answerChain.replace(
    '{standalone_question}',
    standaloneQuestion,
  );

  messages.push({
    role: 'user',
    content: buildUserMessageWithImages(humanMessage, imageDocuments),
  });

  return { system: systemMessage, messages };
}

export function validateAnswerGenerator(model: LanguageModelV3): void {
  if (!model) {
    throw new Error('Error generating final answer: No model instance');
  }
}
