/**
 * Turning Docling's boxes into something a viewer can draw.
 *
 * Docling reports absolute points from a bottom-left origin; the overlay wants
 * top-left fractions of the page. The conversion happens once, here, because
 * doing it in the component means every consumer needs the page size, the
 * origin flag and the zoom, and gets one of them wrong.
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}));
jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { convertWithDocling } from '../docling-client';

const A4 = { width: 612, height: 792 };

const respond = (document: Record<string, unknown>) => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', document, errors: [] }),
  });
};

const convert = () => convertWithDocling('/tmp/f.pdf', 'f.pdf');

/** One page, one element, whatever box and page size the case is about. */
const oneElement = (
  bbox: unknown,
  size: { width: number; height: number } | undefined = A4,
  text = 'Tekst elementu.',
) => ({
  md_content: text,
  json_content: {
    texts: [{ text, prov: [{ page_no: 1, bbox }] }],
    pages: { '1': { page_no: 1, ...(size ? { size } : {}) } },
  },
});

beforeEach(() => {
  mockFetch.mockReset();
});

describe('normalising a box', () => {
  it('converts a bottom-left box to a top-left fraction', async () => {
    // The fixture's own first element: t 772.38 on a 792-point page is 2.48%
    // down from the top, not 97.5%.
    respond(
      oneElement({
        l: 16.6,
        t: 772.38,
        r: 592.69,
        b: 737.01,
        coord_origin: 'BOTTOMLEFT',
      }),
    );

    const { pageAnchors } = await convert();

    expect(pageAnchors[0].region).toEqual({
      page: 1,
      x: 0.0271,
      y: 0.0248,
      w: 0.9413,
      h: 0.0447,
    });
  });

  it('reads the origin flag instead of assuming it', async () => {
    // The same numbers under TOPLEFT describe a box near the *bottom*.
    // Assuming bottom-left flips every rectangle to the wrong end of the page.
    respond(
      oneElement({
        l: 16.6,
        t: 737.01,
        r: 592.69,
        b: 772.38,
        coord_origin: 'TOPLEFT',
      }),
    );

    const { pageAnchors } = await convert();

    expect(pageAnchors[0].region).toMatchObject({
      y: 0.9306,
      h: 0.0447,
    });
  });

  it('treats an unstated origin as bottom-left, which is what Docling sends', async () => {
    respond(oneElement({ l: 0, t: 792, r: 612, b: 396 }));

    const { pageAnchors } = await convert();

    expect(pageAnchors[0].region).toEqual({
      page: 1,
      x: 0,
      y: 0,
      w: 1,
      h: 0.5,
    });
  });

  it('carries the page the box belongs to', async () => {
    respond({
      md_content: 'Pierwsza strona.\n\nDruga strona.',
      json_content: {
        texts: [
          {
            text: 'Pierwsza strona.',
            prov: [{ page_no: 1, bbox: { l: 0, t: 792, r: 612, b: 692 } }],
          },
          {
            text: 'Druga strona.',
            prov: [{ page_no: 2, bbox: { l: 0, t: 400, r: 306, b: 300 } }],
          },
        ],
        pages: {
          '1': { page_no: 1, size: A4 },
          // A second page of a different size, so a single shared page box
          // would produce visibly wrong numbers here.
          '2': { page_no: 2, size: { width: 1224, height: 1584 } },
        },
      },
    });

    const { pageAnchors } = await convert();

    expect(pageAnchors.map((a) => a.region)).toEqual([
      { page: 1, x: 0, y: 0, w: 1, h: 0.1263 },
      { page: 2, x: 0, y: 0.7475, w: 0.25, h: 0.0631 },
    ]);
  });
});

describe('a box that cannot be used', () => {
  /**
   * Invariant 2, and the reason it is worth a test each: `continue`-ing the
   * loop is the obvious implementation, and it skips the cursor advance. The
   * next element then matches an earlier occurrence of its own string or
   * misses entirely — the anchor vanishes and `source_page` changes, silently.
   */
  const stillAnchors = async (json_content: Record<string, unknown>) => {
    respond({ md_content: 'Pierwszy akapit.\n\nDrugi akapit.', json_content });
    const { pageAnchors } = await convert();
    return pageAnchors;
  };

  const twoElements = (firstBbox: unknown, pages: Record<string, unknown>) => ({
    texts: [
      { text: 'Pierwszy akapit.', prov: [{ page_no: 1, bbox: firstBbox }] },
      {
        text: 'Drugi akapit.',
        prov: [{ page_no: 1, bbox: { l: 0, t: 600, r: 612, b: 500 } }],
      },
    ],
    pages,
  });

  it('drops the region and keeps the anchor when the page size is missing', async () => {
    const anchors = await stillAnchors(
      twoElements({ l: 0, t: 792, r: 612, b: 692 }, { '1': { page_no: 1 } }),
    );

    expect(anchors).toEqual([
      { offset: 0, page: 1 },
      { offset: 18, page: 1 },
    ]);
  });

  it('drops the region and keeps the anchor when the page size is zero', async () => {
    const anchors = await stillAnchors(
      twoElements(
        { l: 0, t: 792, r: 612, b: 692 },
        { '1': { page_no: 1, size: { width: 0, height: 0 } } },
      ),
    );

    expect(anchors[0]).toEqual({ offset: 0, page: 1 });
    expect(anchors[1]).toMatchObject({ offset: 18, page: 1 });
  });

  it('drops the region and keeps the anchor when there is no box at all', async () => {
    const anchors = await stillAnchors(
      twoElements(undefined, { '1': { page_no: 1, size: A4 } }),
    );

    expect(anchors[0]).toEqual({ offset: 0, page: 1 });
    expect(anchors[1].region).toBeDefined();
  });

  it('drops a box with a non-finite coordinate', async () => {
    const anchors = await stillAnchors(
      twoElements(
        { l: 0, t: null, r: 612, b: 692 },
        {
          '1': { page_no: 1, size: A4 },
        },
      ),
    );

    expect(anchors[0]).toEqual({ offset: 0, page: 1 });
  });

  it('drops a box with no area rather than emitting a point', async () => {
    // A zero-height rectangle is not a highlight, and a *negative* one is a
    // coordinate-origin bug that should not be normalised into something
    // drawable.
    const anchors = await stillAnchors(
      twoElements(
        { l: 100, t: 500, r: 100, b: 400 },
        {
          '1': { page_no: 1, size: A4 },
        },
      ),
    );

    expect(anchors[0]).toEqual({ offset: 0, page: 1 });
  });

  it('clamps a box that overruns the page', async () => {
    // OCR boxes can overrun by a fraction of a point, and the field's contract
    // says 0–1.
    respond(oneElement({ l: -5, t: 800, r: 620, b: 700 }));

    const { pageAnchors } = await convert();

    const region = pageAnchors[0].region!;
    expect(region.x).toBe(0);
    expect(region.y).toBe(0);
    expect(region.x + region.w).toBeLessThanOrEqual(1);
    expect(region.y + region.h).toBeLessThanOrEqual(1);
  });
});

describe('the walk stays texts-only', () => {
  /**
   * Invariant 1. A table between two paragraphs must not touch the shared
   * cursor: folding `tables` into this loop adds `indexOf` calls that move it,
   * and the text element after the table then matches a later occurrence of
   * its string or misses entirely.
   *
   * The trap is built in: the word the table contains also opens the second
   * paragraph, so a cursor that advanced past the table would land the second
   * anchor on the wrong offset.
   */
  it('keeps text offsets when a table sits between two paragraphs', async () => {
    const markdown = [
      'Pierwszy akapit.',
      '',
      '| Limit | Kwota |',
      '| --- | --- |',
      '| Monitor | 2847 |',
      '',
      'Monitor zewnetrzny podlega limitowi.',
    ].join('\n');

    respond({
      md_content: markdown,
      json_content: {
        texts: [
          {
            text: 'Pierwszy akapit.',
            prov: [{ page_no: 1, bbox: { l: 0, t: 792, r: 612, b: 700 } }],
          },
          {
            text: 'Monitor zewnetrzny podlega limitowi.',
            prov: [{ page_no: 1, bbox: { l: 0, t: 400, r: 612, b: 300 } }],
          },
        ],
        tables: [
          {
            prov: [{ page_no: 1, bbox: { l: 0, t: 690, r: 612, b: 410 } }],
            data: { table_cells: [{ text: 'Monitor' }] },
          },
        ],
        pages: { '1': { page_no: 1, size: A4 } },
      },
    });

    const { pageAnchors } = await convert();

    expect(pageAnchors).toEqual([
      {
        offset: 0,
        page: 1,
        region: { page: 1, x: 0, y: 0, w: 1, h: 0.1162 },
      },
      {
        offset: markdown.indexOf('Monitor zewnetrzny'),
        page: 1,
        region: { page: 1, x: 0, y: 0.4949, w: 1, h: 0.1263 },
      },
    ]);
    // The trap: the table's own cell text occurs earlier in the markdown, so
    // an implementation that anchored it would have moved the cursor past the
    // wrong "Monitor".
    expect(markdown.indexOf('Monitor')).toBeLessThan(
      markdown.indexOf('Monitor zewnetrzny'),
    );
  });
});
