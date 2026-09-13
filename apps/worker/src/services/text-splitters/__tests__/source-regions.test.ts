import { MAX_SOURCE_REGIONS, type SourceRegion } from '@ragenai/rag-core';

import { attachSourcePages, type PageAnchor } from '../source-pages';
import type { Document } from '../../../types/Document';

/**
 * Which boxes belong to a chunk.
 *
 * `sourcePage` is the page of the last anchor at or *before* the chunk starts —
 * a lookup backwards. The regions are the boxes of the anchors *inside* it — a
 * scan forwards. The two answer different questions and the second is allowed
 * to be a few characters wrong, which is the part worth testing rather than
 * assuming.
 */
const PARAGRAPHS = [
  'Zasady ogolne umowy najmu lokalu uzytkowego.',
  'Warunki platnosci oraz terminy przelewow bankowych.',
  'Postanowienia koncowe i tryb rozwiazania umowy.',
  'Zalacznik nr 1 zawiera wykaz wyposazenia lokalu.',
];
const MARKDOWN = PARAGRAPHS.join('\n\n');

const region = (page: number, y: number): SourceRegion => ({
  page,
  x: 0.05,
  y,
  w: 0.9,
  h: 0.05,
});

const ANCHORS: PageAnchor[] = PARAGRAPHS.map((text, index) => ({
  offset: MARKDOWN.indexOf(text),
  // Two paragraphs per page, so a chunk can cover elements from one page and
  // a wider one can cover two.
  page: Math.floor(index / 2) + 1,
  region: region(Math.floor(index / 2) + 1, 0.1 * (index + 1)),
}));

const chunk = (pageContent: string): Document => ({
  pageContent,
  metadata: { fileName: 'umowa.pdf' },
});

const regionsOf = (
  pageContent: string,
  anchors: readonly PageAnchor[] = ANCHORS,
) =>
  attachSourcePages([chunk(pageContent)], MARKDOWN, anchors)[0].metadata
    .sourceRegions as SourceRegion[] | undefined;

describe('the regions a chunk carries', () => {
  it('collects the box of the one element it covers', () => {
    expect(regionsOf(PARAGRAPHS[1])).toEqual([ANCHORS[1].region]);
  });

  it('collects every element inside its span, in reading order', () => {
    const text = [PARAGRAPHS[0], PARAGRAPHS[1], PARAGRAPHS[2]].join('\n\n');

    expect(regionsOf(text)).toEqual([
      ANCHORS[0].region,
      ANCHORS[1].region,
      ANCHORS[2].region,
    ]);
  });

  it('spans two pages when the chunk does', () => {
    const text = [PARAGRAPHS[1], PARAGRAPHS[2]].join('\n\n');

    expect(regionsOf(text)?.map((r) => r.page)).toEqual([1, 2]);
    // And `sourcePage` still answers its own question — the page the chunk
    // *starts* on, not the set it touches.
    expect(
      attachSourcePages([chunk(text)], MARKDOWN, ANCHORS)[0].metadata
        .sourcePage,
    ).toBe(1);
  });

  it('omits the key rather than writing an empty array', () => {
    // Absence is the discriminator all the way down: `[]` would read as "this
    // chunk covers no part of the page", where the truth is that the parser
    // gave no box.
    const anchors: PageAnchor[] = ANCHORS.map(({ offset, page }) => ({
      offset,
      page,
    }));

    const result = attachSourcePages(
      [chunk(PARAGRAPHS[1])],
      MARKDOWN,
      anchors,
    )[0];

    expect(result.metadata.sourceRegions).toBeUndefined();
    expect('sourceRegions' in result.metadata).toBe(false);
    // The page is unaffected: regions are an addition, not a replacement.
    expect(result.metadata.sourcePage).toBe(1);
  });

  it('skips anchors with no box while keeping the ones that have it', () => {
    const anchors: PageAnchor[] = ANCHORS.map((anchor, index) =>
      index === 1 ? { offset: anchor.offset, page: anchor.page } : anchor,
    );
    const text = [PARAGRAPHS[0], PARAGRAPHS[1], PARAGRAPHS[2]].join('\n\n');

    expect(regionsOf(text, anchors)).toEqual([
      ANCHORS[0].region,
      ANCHORS[2].region,
    ]);
  });

  it('leaves a chunk it cannot locate alone', () => {
    const result = attachSourcePages(
      [chunk('Tresc, ktorej w tym dokumencie nie ma.')],
      MARKDOWN,
      ANCHORS,
    )[0];

    expect(result.metadata.sourceRegions).toBeUndefined();
    expect(result.metadata.sourcePage).toBeUndefined();
  });

  it('caps the list rather than describing a whole page', () => {
    // Past a few dozen rectangles the highlight is the page, and the payload
    // bytes buy nothing.
    const lines = Array.from(
      { length: MAX_SOURCE_REGIONS + 10 },
      (_, index) => `Punkt numer ${index} z opisem pozycji w wykazie.`,
    );
    const markdown = lines.join('\n\n');
    const anchors: PageAnchor[] = lines.map((line, index) => ({
      offset: markdown.indexOf(line),
      page: 1,
      region: region(1, index / 100),
    }));

    const result = attachSourcePages([chunk(markdown)], markdown, anchors)[0];

    expect(result.metadata.sourceRegions).toHaveLength(MAX_SOURCE_REGIONS);
    // The first ones, not an arbitrary window: reading order is what makes the
    // list mean anything.
    expect((result.metadata.sourceRegions as SourceRegion[])[0]).toEqual(
      anchors[0].region,
    );
  });

  it('stops at the chunk, not at the document', () => {
    // The span ends at `start + length`. Knowingly approximate — the splitter
    // alters characters at boundaries — but it must not run to the end of the
    // markdown, which would give every chunk every box.
    expect(regionsOf(PARAGRAPHS[0])).toEqual([ANCHORS[0].region]);
    expect(regionsOf(PARAGRAPHS[3])).toEqual([ANCHORS[3].region]);
  });
});
