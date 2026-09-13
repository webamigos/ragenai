import type { RetrievedSource } from '@/libs/chains/types/common';
import type {
  ApiSseRetrieval,
  ApiSseRetrievedSource,
} from '../contracts/events.types';

/**
 * What the browser is told about retrieval, field by field.
 *
 * This exists because passing the chain's own object through was not the
 * same thing as sending the declared contract, and TypeScript could not say
 * so. `RetrievedSource` carries a `snippet` — up to 2 kB of document text,
 * kept for the analytics row — and `ApiSseRetrievedSource` does not declare
 * one. Excess-property checking only applies to object literals, so
 * `sources: retrieval.sources` type-checked and shipped the snippets to a
 * client that never read them.
 *
 * Writing the mapping out is what makes the contract enforceable: a field
 * added to the chain reaches the browser only if someone adds it here too,
 * and this file has a test.
 *
 * Each optional field is omitted rather than sent as `undefined` or
 * defaulted, because absence is what the receiving side reads. A missing
 * `relevanceScore` means reranking did not run; a missing `sourcePage` means
 * the parser could not say which page — neither is a zero.
 */
export function toRetrievalEventSource(
  source: RetrievedSource,
): ApiSseRetrievedSource {
  return {
    fileId: source.fileId,
    fileName: source.fileName,
    chunkCount: source.chunkCount,
    ...(source.relevanceScore !== undefined
      ? { relevanceScore: source.relevanceScore }
      : {}),
    ...(source.sourcePage !== undefined
      ? { sourcePage: source.sourcePage }
      : {}),
    // Copied rather than aliased, and dropped when empty. The array is small
    // and the browser is free to sort or slice it; handing over the chain's
    // own array would let a renderer mutate the object the citation and
    // analytics paths still read. Empty becomes absent because that is what
    // the contract declares — an empty list reads as "came from no pages",
    // where the truth is that no chunk carried one.
    ...(source.pages !== undefined && source.pages.length > 0
      ? { pages: [...source.pages] }
      : {}),
    // Copied, dropped when empty, same as `pages` and for the same reason.
    ...(source.sourceRegions !== undefined && source.sourceRegions.length > 0
      ? { sourceRegions: source.sourceRegions.map((region) => ({ ...region })) }
      : {}),
    ...(source.snippet !== undefined && source.snippet.length > 0
      ? { snippet: source.snippet }
      : {}),
  };
}

export function toRetrievalEvent(retrieval: {
  sources: readonly RetrievedSource[];
  chunkCount: number;
  durationMs: number;
}): ApiSseRetrieval {
  return {
    sources: retrieval.sources.map(toRetrievalEventSource),
    chunkCount: retrieval.chunkCount,
    durationMs: retrieval.durationMs,
  };
}
