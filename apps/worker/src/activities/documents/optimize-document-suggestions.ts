import { generateObject } from 'ai';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getChatModelForOrg } from '../../services/llm/provider';
import { withLangfuseTrace } from '../../services/langfuse-trace';
import { logger } from '../../services/logger';
import { SUMMARY_MODEL } from '../../consts';
import { db } from '../../services/db/db';
import {
  evaluateSuggestionDimensions,
  type SuggestionDimensions,
} from './evaluate-suggestion-dimensions';

const MAX_INPUT_CHARS = 12_000;

/** How many suggestions are evaluated at once — see the call site. */
const EVALUATION_CONCURRENCY = 4;

/** Promise.all with a ceiling, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) {
          return;
        }
        results[index] = await fn(items[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

// ── Schemas ────────────────────────────────────────────────────────────────

const suggestionTypeSchema = z.enum([
  'restructure',
  'chunk_split',
  'pronoun_context',
  'terminology',
  'keywords',
  'redundancy',
]);

const optimizationSuggestionSchema = z.object({
  id: z.string(),
  type: suggestionTypeSchema,
  location: z.string().describe('Gdzie w dokumencie ta zmiana jest stosowana'),
  before: z.string().describe('Oryginalny fragment tekstu'),
  after: z.string().describe('Proponowany zamiennik'),
  rationale: z.string().describe('Dlaczego ta zmiana poprawia retrieval RAG'),
});

const suggestionsResponseSchema = z.object({
  suggestions: z.array(optimizationSuggestionSchema).min(1).max(20),
});

// ── System prompts ─────────────────────────────────────────────────────────

const SUGGESTION_SYSTEM_PROMPT = `Jesteś ekspertem ds. optymalizacji treści pod kątem RAG (Retrieval-Augmented Generation). Analizuj dokument i proponuj konkretne, ukierunkowane ulepszenia. Wszystkie pola tekstowe (rationale, location) wypełniaj wyłącznie w języku polskim.

Dokument jest oceniany według 5 wymiarów (spójnie z systemem scoringu):
1. STRUKTURA CHUNKÓW (chunkStructure): Nagłówki tworzące naturalne granice podziału dla text splitterów. Każda sekcja powinna mieć 150–380 słów (256–512 tokenów — optimum dla modeli embeddingowych). Sekcje krótsze niż 80 słów są zbyt małe, dłuższe niż 500 słów tracą precyzję retrieval.
2. SAMOWYSTARCZALNOŚĆ (selfContainedness): Każda sekcja musi być zrozumiała samodzielnie. Powtarzaj kluczowy kontekst (nazwy podmiotów, kwoty, daty) — nie polegaj na "jak wspomniano wyżej". Dodawaj 1-2 zdania kontekstu na początku każdej sekcji opisujące czego dotyczy ("Ta sekcja opisuje warunki wynagrodzenia Inspektora nadzoru budowlanego zgodnie z umową z dnia…").
3. GĘSTOŚĆ ENCJI (entityDensity): Zawieraj konkretne, wyszukiwalne encje: pełne nazwy podmiotów, kwoty pieniężne, daty, numery artykułów prawnych, dane kontaktowe, czasy trwania. Wzmacniają one wyszukiwanie BM25/sparse retrieval — szczególnie ważne przy zapytaniach o konkretne fakty.
4. KONTEKST ZAIMKÓW: Zastępuj zaimki ("to", "on", "oni") bezpośrednimi odniesieniami do ich poprzedników. To poprawia zarówno samowystarczalność jak i gęstość encji.
5. FORMAT Q&A (qaAdherence): Przeformułuj prozę na pary pytanie-odpowiedź tam gdzie to naturalne. Badania (QREAM, 2026) potwierdzają ~8% wzrost retrieval accuracy przy formacie Q&A. Nagłówki sekcji mogą być pytaniami ("Kiedy należy zapłacić wynagrodzenie?" zamiast "Wynagrodzenie").

Dodatkowe zasady:
- TERMINOLOGIA: Używaj spójnej terminologii. Jeśli używasz słowa "pracownik", nie przeplataj go słowami "zatrudniony" czy "personel".
- SŁOWA KLUCZOWE/SYNONIMY: Dodawaj synonimy kluczowych pojęć, aby zarówno wyszukiwanie dokładne (BM25), jak i semantyczne (dense) mogły znaleźć sekcję.
- REDUNDANCJA: Usuwaj wypełniacze ("Należy zauważyć, że", "Jak wspomniano wcześniej"), które rozcieńczają gęstość informacji.

Typy sugestii:
- "restructure": Dodaj/zmodyfikuj nagłówki, podziel długie sekcje, dodaj kontekst na początku sekcji
- "chunk_split": Podziel sekcję przekraczającą 380 słów na wiele samowystarczalnych sekcji
- "pronoun_context": Zastąp zaimki bezpośrednimi odniesieniami do encji
- "terminology": Ujednolicenie niespójnego użycia terminologii
- "keywords": Dodaj synonimy lub kluczowe frazy poprawiające wyszukiwalność
- "redundancy": Usuń wypełniacze i powtarzające się treści

KRYTYCZNE ZASADY dla pól "before" i "after":
1. Pole "before" MUSI zawierać dokładny fragment tekstu z dokumentu — kopiuj dosłownie, znak po znaku, łącznie z białymi znakami i newliniami. Nawet jedna różnica spowoduje że zmiana nie zostanie zastosowana.
2. Pole "after" to WYŁĄCZNIE zamiennik dla fragmentu z "before" — nie może zawierać niczego spoza zakresu tego fragmentu.
3. NIGDY nie duplikuj treści: "after" nie może zawierać fragmentów które już istnieją w dokumencie poza zastępowanym blokiem. Jeśli usuwasz duplikat, "before" musi obejmować CAŁY duplikat (oba wystąpienia), a "after" tylko jedno czyste wystąpienie.
4. Nie używaj pustych pól before/after — każda sugestia musi mieć konkretny fragment.
5. Jedna sugestia = jedna atomowa zmiana. Nie łącz wielu niezależnych zmian w jedną sugestię.`;

// ── Helpers ────────────────────────────────────────────────────────────────

function applySuggestion(
  content: string,
  before: string,
  after: string,
): string {
  if (!before || !after) {
    return content;
  }
  return content.replace(before, after);
}

// ── Main activity ──────────────────────────────────────────────────────────

export type OptimizationJobStatus =
  'pending' | 'processing' | 'done' | 'failed';

export type OptimizationSuggestion = {
  id: string;
  type: string;
  location: string;
  before: string;
  after: string;
  rationale: string;
  dimensions: SuggestionDimensions;
  stale?: boolean;
};

export type OptimizationJob = {
  id: string;
  status: OptimizationJobStatus;
  baseScore: number | null;
  suggestions: OptimizationSuggestion[];
  noNewSuggestions?: boolean;
  error?: string;
  startedAt: string;
  completedAt?: string;
};

export async function optimizeDocumentSuggestions({
  jobId,
  documentId,
  orgId,
  projectId,
  userId,
  documentText,
  documentTitle,
  baseScore: canonicalBaseScore,
}: {
  jobId: string;
  documentId: string;
  orgId: string;
  projectId?: string | null;
  userId?: string | null;
  documentText: string;
  documentTitle?: string;
  baseScore?: number | null;
}): Promise<void> {
  const startedAt = Date.now();

  // Mark as processing — preserve existing suggestions so the user can still
  // see and act on them while the new job runs. Only id/status/baseScore are
  // updated here; suggestions are replaced when the worker writes 'done'.
  await db.updateOptimizationJobFields({
    documentId,
    orgId,
    fields: {
      id: jobId,
      status: 'processing',
      baseScore: canonicalBaseScore ?? null,
      startedAt: new Date().toISOString(),
    },
  });

  try {
    const model = await getChatModelForOrg(orgId, SUMMARY_MODEL);

    // 1. Generate candidate suggestions
    const truncated =
      documentText.length > MAX_INPUT_CHARS
        ? documentText.slice(0, MAX_INPUT_CHARS)
        : documentText;

    const suggestionsResult = await withLangfuseTrace(
      {
        name: 'rag-generate-suggestions',
        tags: ['rag-optimizer', SUMMARY_MODEL],
      },
      () =>
        generateObject({
          model,
          schema: suggestionsResponseSchema,
          system: SUGGESTION_SYSTEM_PROMPT,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: `Przeanalizuj ten dokument i zaproponuj konkretne sugestie optymalizacji pod RAG. Wszystkie pola tekstowe wypełnij w języku polskim:\n\n${truncated}`,
            },
          ],
          experimental_telemetry: { isEnabled: true },
        }),
    );

    const rawSuggestions = suggestionsResult.object.suggestions.map((s) => ({
      ...s,
      id: randomUUID(),
    }));

    logger.info(
      { documentId, count: rawSuggestions.length },
      'Generated RAG optimization suggestions',
    );

    // 2. Filter candidates: skip empty before/after and suggestions whose
    //    before text doesn't appear in the document.
    const candidates = rawSuggestions.filter((suggestion) => {
      if (!suggestion.before || !suggestion.after) {
        logger.info(
          { id: suggestion.id },
          'Suggestion skipped — empty before/after',
        );
        return false;
      }
      const modified = applySuggestion(
        documentText,
        suggestion.before,
        suggestion.after,
      );
      if (modified === documentText) {
        logger.info(
          { id: suggestion.id },
          'Suggestion skipped — before not found in document',
        );
        return false;
      }
      return true;
    });

    // 3. Evaluate the valid suggestions, a few at a time. Each evaluation is
    //    itself several LLM calls and the model can return up to 20
    //    suggestions, so an unbounded Promise.all is a burst of ~100 concurrent
    //    requests at the proxy.
    const evaluated = await mapWithConcurrency(
      candidates,
      EVALUATION_CONCURRENCY,
      async (suggestion) => {
        const dimensions = await evaluateSuggestionDimensions({
          before: suggestion.before,
          after: suggestion.after,
          suggestionType: suggestion.type as Parameters<
            typeof evaluateSuggestionDimensions
          >[0]['suggestionType'],
          orgId,
          projectId,
          userId,
        });
        logger.info(
          {
            id: suggestion.id,
            type: suggestion.type,
            improvedDimensions: Object.keys(dimensions),
          },
          'Suggestion evaluated',
        );
        return { ...suggestion, dimensions } as OptimizationSuggestion;
      },
    );

    const validSuggestions = evaluated;

    const durationMs = Date.now() - startedAt;

    await db.trackAiUsage({
      organizationId: orgId,
      projectId: projectId ?? null,
      userId: userId ?? null,
      step: 'CHAT_COMPLETION',
      provider: 'litellm',
      model: SUMMARY_MODEL,
      inputTokens: suggestionsResult.usage?.inputTokens ?? 0,
      outputTokens: suggestionsResult.usage?.outputTokens ?? 0,
      totalTokens: suggestionsResult.usage?.totalTokens ?? 0,
      durationMs,
      metadata: {
        kind: 'rag_optimizer',
        suggestionCount: validSuggestions.length,
        documentTitle,
      },
    });

    // 4. Save results to UserDocument.metadata.
    // If no new suggestions were found but there are existing undecided ones
    // (from a previous job), keep them and set noNewSuggestions=true so the
    // frontend can show "no new suggestions found" instead of "fully optimized".
    const resolvedBaseScore = canonicalBaseScore ?? null;

    if (validSuggestions.length === 0) {
      await db.updateOptimizationJobFields({
        documentId,
        orgId,
        fields: {
          id: jobId,
          status: 'done',
          baseScore: resolvedBaseScore,
          noNewSuggestions: true,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date().toISOString(),
        },
      });
    } else {
      // Append new suggestions to existing undecided ones so the user
      // doesn't lose previous suggestions they haven't acted on yet.
      const existing = await db.getOptimizationJobSuggestions({
        documentId,
        orgId,
      });
      const existingTyped = existing as OptimizationSuggestion[];
      const newIds = new Set(validSuggestions.map((s) => s.id));
      const merged = [
        ...existingTyped.filter((s) => !newIds.has(s.id)),
        ...validSuggestions,
      ];
      await db.updateOptimizationJobFields({
        documentId,
        orgId,
        fields: {
          id: jobId,
          status: 'done',
          baseScore: resolvedBaseScore,
          noNewSuggestions: false,
          suggestions: merged,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date().toISOString(),
        },
      });
    }

    logger.info(
      { documentId, jobId, accepted: validSuggestions.length, durationMs },
      'Document optimization job completed',
    );
  } catch (err) {
    logger.error(
      { err, documentId, jobId },
      'Document optimization job failed',
    );

    // Field-wise, not a whole-object replace: mergeDocumentMetadata merges at
    // the *metadata* level, so writing a full optimizationJob here would drop
    // the previous run's suggestions and baseScore — the ones the user can
    // still act on, and which the success path deliberately preserves.
    await db.updateOptimizationJobFields({
      documentId,
      orgId,
      fields: {
        id: jobId,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        completedAt: new Date().toISOString(),
      },
    });

    throw err;
  }
}
