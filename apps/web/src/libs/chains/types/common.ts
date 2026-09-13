import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { SourceRegion } from '@ragenai/rag-core';
import type { ModerationInstance } from '@/app/lib/services/llm';
import type { EmbeddingsProvider } from '@/libs/llm/types/embeddings';

/** Maximum number of tool-use steps allowed per stream when MCP tools are enabled. */
export const MAX_TOOL_STEPS = 10;

export interface BaseChatChainInput {
  question: string;
  chat_history: string | undefined;
}

export interface BaseChatChainModels {
  contentModerator: ModerationInstance;
  answerGenerator: LanguageModelV3;
}

export interface RagChainModels extends BaseChatChainModels {
  questionRephraser: LanguageModelV3;
  embeddings: EmbeddingsProvider;
}

export interface ChainTrackingContext {
  organizationId: string;
  projectId?: string | null;
  userId?: string | null;
}

export interface ChainRagSettings {
  multiQueryEnabled: boolean;
  contentModerationEnabled: boolean;
  rerankingEnabled: boolean;
}

export interface ChainConfig {
  answerInstructions?: string | null;
  projectInstruction?: string;
  /**
   * Cap on generated tokens. Threaded through to `streamText({ maxTokens })`.
   * Leave undefined for provider default. Populated by the OpenAI-compatible
   * API (`/api/v1/chat/completions`) from the caller's `max_tokens`.
   */
  maxTokens?: number;
  ragSettings?: ChainRagSettings;
  mcpTools?: Record<string, any>;
  mcpContext?: string;
  tracking?: ChainTrackingContext;
  threadDocuments?: import('@/features/documents/contracts/document.types').ThreadDocumentUI[];
  /**
   * Tool call IDs the user has already explicitly approved for this turn.
   * Populated in Phase 2b (modal approval re-entry). Phase 2a always
   * passes an empty array — a paused tool stays paused until the user
   * sends a new message expressing explicit intent.
   */
  approvedToolCalls?: readonly string[];
}

export interface RagChainConfig extends ChainConfig {
  maxDocumentsToRetrieve?: number;
  metadataFilter?: object;
  /**
   * The thread's knowledge scope. Only `MODEL_ONLY` changes what this chain
   * does — it skips the knowledge-base retrieval entirely. The other two
   * levels differ in *what* they retrieve, which is the metadata filter's job,
   * not this one's.
   *
   * Defaults to retrieving when absent, so a caller that has not been taught
   * about scopes behaves exactly as before.
   */
  knowledgeScope?: import('@ragenai/platform-contracts').KnowledgeScope;
  /** Org's virtual LiteLLM key — used to attribute rerank usage to the org. */
  litellmApiKey?: string;
}

export interface ChainUsage {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  totalTokens: number | undefined;
}

/**
 * One knowledge-base file whose chunks were placed in front of the model.
 *
 * `fileName` is what the chunk was rendered with (`<chunk file="…">`), which is
 * also the only handle the model has to cite it by — see
 * `features/documents/utils/cited-sources.ts`. Null for chunks ingested before
 * file names were stored in metadata.
 */
export interface RetrievedSource {
  fileId: string;
  fileName: string | null;
  /**
   * How relevant the reranker judged this file's best chunk, 0–1.
   *
   * **Absent on a default installation.** Reranking is opt-in
   * (`FEATURE_FLAG_RERANKING` plus provider credentials), so most deployments
   * produce no score at all — and the fallback path inside each reranker
   * returns documents unscored when the provider errors. Absence means "not
   * measured", never "scored zero", and the UI must not draw a bar for it.
   */
  relevanceScore?: number;
  /**
   * The page of the document this file's best chunk came from, 1-based.
   *
   * Absent whenever the parser could not say: every legacy loader, every
   * unpaginated format, and any chunk Docling's elements could not be matched
   * to. Absence is the discriminator, so it is never defaulted to 1 — a
   * document ingested before the field existed must not be labelled by a rule
   * it predates.
   */
  sourcePage?: number;
  /**
   * The text of the chunk this file contributed — what the model actually
   * read, so the source card can quote it.
   *
   * Taken from the file's **highest-ranked surviving chunk**, the same one
   * that supplies `relevanceScore`, never assembled from two. A card whose
   * rank came from one chunk and whose quote came from another would cite a
   * passage the score does not describe.
   */
  snippet?: string;
  /**
   * How many of this file's chunks survived into the final set.
   *
   * The other fields describe the file's **best** chunk; this one describes
   * how much of the file the model actually read, which is the question the
   * sources rail exists to answer. A file that contributed six chunks and one
   * that contributed one were not consulted to the same depth, and until this
   * existed the two were indistinguishable — the dedupe kept the first chunk
   * per file and dropped the rest on the floor.
   *
   * Always at least 1: a file is in `sources` because a chunk of it is.
   */
  chunkCount: number;
  /**
   * The distinct pages those chunks came from, ascending.
   *
   * Absent — not empty — when no chunk of this file carried a page, which is
   * every file from a legacy loader and every unpaginated format. Same rule as
   * `sourcePage`: absence means "the parser could not say", and an empty array
   * would read as "came from no pages".
   *
   * This is not a superset of `sourcePage` that makes it redundant. That field
   * is the page of the *best* chunk, which the sources block labels a single
   * source with; this is where the file was read from overall. The best chunk
   * is often not the lowest-numbered one, so `pages[0]` is not `sourcePage`.
   */
  pages?: number[];
  /**
   * Where on its page the quoted passage sits, as top-left-origin fractions of
   * the page box.
   *
   * From the **same chunk** as `relevanceScore`, `sourcePage` and `snippet`,
   * so a highlight points at the passage the card quotes rather than at some
   * other part of the file. Not a per-file union the way `pages` is: a
   * rectangle only means anything on one page.
   *
   * Absent — never empty — whenever the parser gave no box: every non-Docling
   * loader, every unpaginated format, and every chunk ingested before the
   * field existed. A re-index is what gives an old document regions.
   */
  sourceRegions?: SourceRegion[];
}

/**
 * What retrieval did for one turn, for the row above the answer:
 * `Searched {n} documents · {m} chunks · {ms} ms`.
 *
 * `null` means retrieval **did not run** — a conversation-mode turn, or a
 * thread scoped to `MODEL_ONLY`. That is different from running and finding
 * nothing, which is a summary with an empty `sources` and a `chunkCount` of
 * zero, and which the reader should be told about: "searched and found
 * nothing" is an answer about the knowledge base, "did not search" is not.
 */
export interface RetrievalSummary {
  /** The files the model was shown, deduped, in final rank order. */
  sources: RetrievedSource[];
  /**
   * Chunks placed in front of the model. Not the same as `sources.length` —
   * one document usually supplies several chunks.
   */
  chunkCount: number;
  /** Wall-clock for the retrieval stage: fan-out, dedupe and rerank. */
  durationMs: number;
}

export interface ChainStreamResult {
  textStream: AsyncIterable<string>;
  text: PromiseLike<string>;
  fullStream: AsyncIterable<ChainStreamPart>;
  reasoningText: PromiseLike<string | undefined>;
  usage: PromiseLike<ChainUsage>;
  /**
   * What retrieval did this turn — what the model *saw*, not what it *cited*.
   * Callers that record citations must intersect `sources` with the answer
   * text; writing it straight to `DocumentCitation` is how the analytics
   * screen came to count every retrieved file as a citation.
   *
   * `null` when retrieval did not run at all. See {@link RetrievalSummary}.
   */
  retrieval: PromiseLike<RetrievalSummary | null>;
}

export type ChainStreamPart =
  | { type: 'text-delta'; textDelta: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: unknown }
  | {
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      result: unknown;
    }
  /**
   * Emitted by the SDK when a tool's `needsApproval` predicate returns
   * true. Phase 2 prompt-injection gating: the tool is NOT executed —
   * the SDK pauses and surfaces this part so the stream can prompt the
   * user for confirmation. See `src/libs/mcp/client.ts` and
   * `src/libs/security/tool-gating-context.ts`.
   */
  | {
      type: 'tool-approval-request';
      approvalId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | { type: 'other'; [key: string]: unknown };

export interface BaseChatChainOutput {
  stream: (input: BaseChatChainInput) => Promise<ChainStreamResult>;
}
