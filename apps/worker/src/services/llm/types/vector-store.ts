/**
 * The canonical shape now lives in `@ragenai/rag-core` (ADR-33).
 *
 * It was hand-kept here and in `apps/web/src/app/lib/types/types.ts`, and the
 * two drifted in both directions. Re-exported rather than deleted so the move
 * landed without touching every import; new code should import from the
 * package.
 */
export {
  type VectorStoreDocumentMetadata,
  type VectorStoreMetadataFilter,
} from '@ragenai/rag-core';
