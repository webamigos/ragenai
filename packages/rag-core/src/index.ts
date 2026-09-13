export { encode, tokenize, fnv1a32, type SparseVector } from './bm25-encoder';

export {
  DENSE_VECTOR_NAME,
  SPARSE_VECTOR_NAME,
  BATCH_SIZE,
  PREFETCH_MULTIPLIER,
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_VECTOR_SIZE,
  VECTOR_SIZE,
  resolveEmbeddingsModel,
} from './vector-contract';

export {
  KNOWN_VECTOR_STORES,
  SUPPORTED_VECTOR_STORES,
  DEFAULT_VECTOR_STORE,
  isKnownVectorStore,
  isSupportedVectorStore,
  resolveDefaultVectorStore,
  type KnownVectorStore,
  type SupportedVectorStore,
} from './vector-store-backends';

export {
  EMBED_BATCH_SIZE,
  MAX_EMBEDDING_TEXT_CHARS,
  truncateForEmbedding,
  prepareEmbeddingBatches,
  type TruncationReporter,
} from './embedding-contract';

export {
  MAX_SOURCE_REGIONS,
  type SourceRegion,
  type VectorStoreDocumentMetadata,
  type VectorStoreMetadataFilter,
} from './vector-metadata';
