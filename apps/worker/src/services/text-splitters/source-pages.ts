import { MAX_SOURCE_REGIONS, type SourceRegion } from '@ragenai/rag-core';

import { type Document } from '../../types/Document';

/**
 * One located text element: where it starts in the markdown, what page it came
 * from, and where it sits on that page when the parser gave a usable box.
 *
 * Still called `PageAnchor` after it stopped being one-per-page — see
 * `buildTextElementAnchors` in the docling client, which produces these.
 */
export type PageAnchor = {
  offset: number;
  page: number;
  region?: SourceRegion;
};

/**
 * Gives each chunk the page it came from.
 *
 * Docling reports a page per element and the markdown it produces is one flat
 * string, so the page has to be recovered by position: a chunk starting at
 * offset X belongs to the page of the last anchor at or before X.
 *
 * **Chunks are located by searching, not by arithmetic.** The splitter returns
 * text without offsets, and reconstructing them by summing lengths does not
 * work — chunks overlap, and separators are consumed at boundaries. Searching
 * for the chunk's own opening text is exact where it succeeds and simply
 * declines to answer where it does not.
 *
 * The search walks forward from the *previous chunk's start*, not its end.
 * Consecutive chunks overlap by `chunkOverlap`, so the next one begins before
 * the last one finished; starting from the end would skip past it and match
 * some later repetition of the same sentence instead.
 *
 * A chunk that cannot be located gets no page. That is the whole point of the
 * exercise: gap 3 exists because a number was shown under the word "page"
 * without being one, and a guessed page repeats the mistake in a form that is
 * harder to spot.
 *
 * **And the boxes of the elements inside it**, where the anchors carry them.
 * `sourcePage` is the page of the last anchor at or before the chunk's start;
 * the regions are those of the anchors *within* the chunk's span.
 */
export function attachSourcePages(
  chunks: Document[],
  markdown: string,
  anchors: readonly PageAnchor[],
): Document[] {
  if (anchors.length === 0 || markdown.length === 0) {
    return chunks;
  }

  let searchFrom = 0;

  return chunks.map((chunk) => {
    const text = chunk.pageContent.trim();
    if (text.length === 0) {
      return chunk;
    }

    const offset = locate(markdown, text, searchFrom);
    if (offset === -1) {
      return chunk;
    }
    // One past this chunk's start, not past its end. Chunks overlap, so the
    // next one begins before this one finishes — resuming from the end would
    // skip it. But two distinct chunks never begin at the *same* offset, so
    // advancing by one is always safe, and it is what lets a document that
    // repeats itself verbatim place its second copy on the right page.
    searchFrom = offset + 1;

    const page = pageAt(offset, anchors);
    if (page === null) {
      return chunk;
    }

    const regions = regionsWithin(offset, text.length, anchors);

    return {
      ...chunk,
      metadata: {
        ...chunk.metadata,
        sourcePage: page,
        // Omitted, never `[]`. Absence is what the overlay reads as "nothing
        // to draw", and an empty array would be a claim that the chunk covers
        // no part of the page.
        ...(regions.length > 0 ? { sourceRegions: regions } : {}),
      },
    };
  });
}

/**
 * The regions of the anchors inside a chunk.
 *
 * **The end of the span is `start + length`, and that is knowingly
 * approximate.** `locate()` finds a chunk's start by probing and verifying a
 * prefix precisely because the splitter alters characters between the markdown
 * and the chunk, so the chunk's length is not exactly the span it occupies in
 * the source. The cost of being a few characters out is one extra rectangle on
 * an adjacent paragraph, or one missing on the last — cosmetic. For
 * `sourcePage` the same error would be a correctness failure, which is why
 * that value keeps its derivation from the start offset alone and does not
 * touch this.
 */
function regionsWithin(
  start: number,
  length: number,
  anchors: readonly PageAnchor[],
): SourceRegion[] {
  const end = start + length;
  const regions: SourceRegion[] = [];

  for (const anchor of anchors) {
    if (anchor.offset >= end) {
      break;
    }
    if (anchor.offset < start || anchor.region === undefined) {
      continue;
    }
    regions.push(anchor.region);
    if (regions.length === MAX_SOURCE_REGIONS) {
      // A highlight covering most of a page tells the reader nothing, so the
      // rest are not worth the payload bytes.
      break;
    }
  }

  return regions;
}

/**
 * A prefix short enough to survive whatever the splitter trimmed at the chunk
 * boundary. Matching the whole chunk fails on any single altered character;
 * matching a few words matches the wrong paragraph.
 */
const PROBE_LENGTH = 60;

/**
 * How much more of the chunk is compared before a candidate is believed.
 *
 * The probe alone is not enough. Documents repeat themselves — a letterhead, a
 * contract's party block, a heading carried onto every page — and once such a
 * run is longer than the probe, two different chunks have identical needles.
 * The second one then matches the *first* one's position (the search resumes
 * from the previous chunk's start, so its own offset is still in range) and
 * silently inherits its page.
 */
const VERIFY_LENGTH = 400;

/**
 * Finds where a chunk starts, disambiguating repeated openings.
 *
 * Candidates are checked in order and the first whose longer window also
 * matches wins. A single unverified candidate is still accepted: with nothing
 * to confuse it for, a mismatch further in means the splitter altered a
 * character, not that the position is wrong — and dropping the page there
 * would lose a correct answer to guard against an ambiguity that does not
 * exist. Several candidates and none verifying is genuinely ambiguous, and
 * gets no page at all.
 */
function locate(markdown: string, text: string, from: number): number {
  const probe = text.slice(0, PROBE_LENGTH);
  const verify = text.slice(0, Math.min(text.length, VERIFY_LENGTH));

  let candidate = markdown.indexOf(probe, from);
  let firstCandidate = -1;
  let candidateCount = 0;

  while (candidate !== -1) {
    if (markdown.startsWith(verify, candidate)) {
      return candidate;
    }
    if (firstCandidate === -1) {
      firstCandidate = candidate;
    }
    candidateCount += 1;
    candidate = markdown.indexOf(probe, candidate + 1);
  }

  return candidateCount === 1 ? firstCandidate : -1;
}

function pageAt(offset: number, anchors: readonly PageAnchor[]): number | null {
  let page: number | null = null;
  for (const anchor of anchors) {
    if (anchor.offset > offset) {
      break;
    }
    page = anchor.page;
  }
  return page;
}
