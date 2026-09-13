export type PropsWihLocale = {
  params: Promise<{
    locale: string;
  }>;
};

/**
 * The canonical shape now lives in `@ragenai/rag-core` (ADR-33).
 *
 * It was hand-kept here and in `apps/worker/src/services/llm/types/vector-store.ts`,
 * and the two drifted in both directions — this copy was eleven fields behind
 * and was the only one that knew about `accessible_by`. Re-exported rather
 * than deleted so the move landed without touching every import; new code
 * should import from the package.
 */
export {
  type VectorStoreDocumentMetadata,
  type VectorStoreMetadataFilter,
} from '@ragenai/rag-core';
