/**
 * The test the ADR-20 exemption rests on.
 *
 * Element-level provenance made the anchor list denser — one entry per located
 * text element instead of one per page — and claims that nothing retrieval can
 * observe changed as a result. That claim is not about the feature, it is about
 * a property of the walk: the cursor advances for every *located* element, so
 * which elements are located and at what offsets does not depend on how many
 * anchors are kept.
 *
 * So this runs the fixture through the **old** one-anchor-per-page walk and the
 * shipped one, chunks both with the same splitter, and asserts the whole chunk
 * output is identical — count, `pageContent`, order and every metadata field.
 * Asserting pages alone would pass an implementation that moved chunk text or
 * boundaries while preserving page assignment, which is exactly the change this
 * spec claims not to make. If this fails, the exemption evaporates and the
 * change owes a measurement.
 *
 * The one permitted difference is the `sourceRegions` key the feature adds, and
 * it is permitted *by name*: `differingMetadataKeys` below asserts that it is
 * the only key the two runs disagree on, so a change that also moved
 * `sourcePage` — or anything else — still fails here.
 *
 * `source-pages.test.ts` cannot see any of this: it feeds a hand-written anchor
 * list, and the change is in the producer.
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('pdf-bytes')),
}));
jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { convertWithDocling } from '../docling-client';
import type { Document } from '../../types/Document';
import { splitMarkdownDocuments } from '../text-splitters';
import {
  attachSourcePages,
  type PageAnchor,
} from '../text-splitters/source-pages';

/**
 * `buildPageAnchors` exactly as it stood before this change, kept here as the
 * reference the new walk is compared against.
 *
 * Copied rather than imported because the point is to compare against code
 * that no longer exists. It must not be "fixed" if it looks dated — a change
 * to it makes this test compare the new implementation with itself.
 */
function buildPageAnchorsAsBefore(
  markdown: string,
  parsed: { texts?: unknown } | null,
): PageAnchor[] {
  const texts = parsed?.texts;
  if (!Array.isArray(texts)) {
    return [];
  }

  const anchors: PageAnchor[] = [];
  let cursor = 0;
  let lastPage: number | null = null;

  for (const element of texts) {
    const text = (element as { text?: unknown })?.text;
    const prov = (element as { prov?: unknown })?.prov;
    if (typeof text !== 'string' || !Array.isArray(prov) || prov.length === 0) {
      continue;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const page = (prov[0] as { page_no?: unknown })?.page_no;
    if (typeof page !== 'number') {
      continue;
    }
    const offset = markdown.indexOf(trimmed, cursor);
    if (offset === -1) {
      continue;
    }
    cursor = offset + trimmed.length;
    if (page !== lastPage) {
      anchors.push({ offset, page });
      lastPage = page;
    }
  }

  return anchors;
}

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures/docling-regulamin-wilczy-mlyn.json'),
    'utf8',
  ),
) as {
  status: string;
  errors: string[];
  document: { md_content: string; json_content: Record<string, unknown> };
};

/**
 * A second document, synthetic, because the fixture is one page.
 *
 * The invariant being defended is about *runs of same-page elements*, and a
 * one-page document has exactly one run. This has several elements per page
 * across four pages, a paragraph that repeats verbatim on two of them, and one
 * element whose text never reaches the markdown — the three things that make
 * the two walks able to disagree.
 */
function buildMultiPageDocument() {
  const boilerplate =
    'ZAKLADY HYDRAULICZNE WILCZY MLYN sp. z o.o. — dokument wewnetrzny.';
  const paragraphs: { text: string; page: number }[] = [];
  for (let page = 1; page <= 4; page += 1) {
    paragraphs.push({ text: boilerplate, page });
    for (let n = 1; n <= 5; n += 1) {
      paragraphs.push({
        text:
          `Punkt ${page}.${n}. Limit zwrotu kosztow wynosi ${page * 100 + n} zl brutto ` +
          `na jednego pracownika, zgodnie z zasadami opisanymi w zalaczniku nr ${n}.`,
        page,
      });
    }
  }
  const markdown = paragraphs.map((p) => p.text).join('\n\n');
  const texts: unknown[] = paragraphs.map((p) => ({
    text: p.text,
    prov: [
      {
        page_no: p.page,
        bbox: { l: 20, t: 700, r: 580, b: 660, coord_origin: 'BOTTOMLEFT' },
      },
    ],
  }));
  // An element Docling reports that the markdown does not contain. Both walks
  // must skip it without disturbing the cursor for what follows.
  texts.splice(7, 0, {
    text: 'Tresc, ktorej w markdownie nie ma.',
    prov: [{ page_no: 2, bbox: { l: 0, t: 10, r: 10, b: 0 } }],
  });
  const pages: Record<string, unknown> = {};
  for (let page = 1; page <= 4; page += 1) {
    pages[String(page)] = { page_no: page, size: { width: 612, height: 792 } };
  }
  return { markdown, json: { texts, pages } };
}

const respond = (md_content: string, json_content: unknown) => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      status: 'success',
      document: { md_content, json_content },
      errors: [],
    }),
  });
};

/**
 * The whole downstream path, so the comparison is over chunks rather than
 * anchors: `splitText`'s Docling branch is exactly this.
 */
const chunk = (
  markdown: string,
  anchors: readonly PageAnchor[],
  budget: { chunkSize: number; chunkOverlap: number },
) =>
  attachSourcePages(
    splitMarkdownDocuments(
      [{ pageContent: markdown, metadata: { fileName: 'f.pdf' } }],
      { ...budget, keepSeparator: true },
    ),
    markdown,
    anchors,
  );

/**
 * The key the feature is allowed to add, and the only one.
 *
 * Stripping it by name rather than comparing a hand-picked subset of fields:
 * a subset comparison silently stops covering whatever is added next, which is
 * the failure mode this whole test exists to avoid.
 */
const withoutRegions = (chunks: Document[]): Document[] =>
  chunks.map((c) => {
    const { sourceRegions: _ignored, ...metadata } = c.metadata as Record<
      string,
      unknown
    >;
    return { ...c, metadata };
  });

/** Every metadata key on which the two runs disagree, across all chunks. */
const differingMetadataKeys = (before: Document[], after: Document[]) => {
  const keys = new Set<string>();
  after.forEach((chunk, index) => {
    const other = before[index]?.metadata ?? {};
    const names = new Set([
      ...Object.keys(chunk.metadata),
      ...Object.keys(other),
    ]);
    for (const name of names) {
      if (
        JSON.stringify(chunk.metadata[name]) !== JSON.stringify(other[name])
      ) {
        keys.add(name);
      }
    }
  });
  return [...keys].sort();
};

/**
 * Several budgets, because a chunk size larger than the document proves
 * nothing. 200/40 cuts the fixture into a dozen pieces; 1000/200 is what a PDF
 * actually gets.
 */
const BUDGETS = [
  { chunkSize: 200, chunkOverlap: 40 },
  { chunkSize: 400, chunkOverlap: 80 },
  { chunkSize: 1000, chunkOverlap: 200 },
];

beforeEach(() => {
  mockFetch.mockReset();
});

describe('a denser anchor list does not move a single chunk', () => {
  it.each(BUDGETS)(
    'produces byte-identical chunks for the recorded PDF at $chunkSize/$chunkOverlap',
    async (budget) => {
      const { md_content, json_content } = fixture.document;
      respond(md_content, json_content);

      const { markdown, pageAnchors } = await convertWithDocling(
        '/tmp/f.pdf',
        'f.pdf',
      );
      const before = chunk(
        markdown,
        buildPageAnchorsAsBefore(markdown, json_content),
        budget,
      );
      const after = chunk(markdown, pageAnchors, budget);

      expect(withoutRegions(after)).toEqual(before);
      expect(differingMetadataKeys(before, after)).toEqual(['sourceRegions']);
      // Guards the comparison itself: equality between two empty arrays would
      // pass and mean nothing.
      expect(after.length).toBeGreaterThan(1);
    },
  );

  it.each(BUDGETS)(
    'produces byte-identical chunks across four pages at $chunkSize/$chunkOverlap',
    async (budget) => {
      const document = buildMultiPageDocument();
      respond(document.markdown, document.json);

      const { markdown, pageAnchors } = await convertWithDocling(
        '/tmp/f.pdf',
        'f.pdf',
      );
      const before = chunk(
        markdown,
        buildPageAnchorsAsBefore(markdown, document.json),
        budget,
      );
      const after = chunk(markdown, pageAnchors, budget);

      expect(withoutRegions(after)).toEqual(before);
      expect(differingMetadataKeys(before, after)).toEqual(['sourceRegions']);
      expect(after.length).toBeGreaterThan(1);
      // The comparison is only worth anything if pages were actually assigned
      // and more than one of them appears.
      const pages = new Set(
        after
          .map((c) => c.metadata.sourcePage)
          .filter((page): page is number => typeof page === 'number'),
      );
      expect(pages.size).toBeGreaterThan(1);
    },
  );

  it('keeps more anchors than the old walk did, which is the change', async () => {
    // Without this, every assertion above could be satisfied by a walk that
    // did not change at all.
    const document = buildMultiPageDocument();
    respond(document.markdown, document.json);

    const { markdown, pageAnchors } = await convertWithDocling(
      '/tmp/f.pdf',
      'f.pdf',
    );
    const before = buildPageAnchorsAsBefore(markdown, document.json);

    expect(before).toHaveLength(4);
    expect(pageAnchors).toHaveLength(24);
    // And the old anchors are a subset: each page's first element still
    // anchors that page at the same offset.
    for (const anchor of before) {
      expect(pageAnchors).toContainEqual(
        expect.objectContaining({ offset: anchor.offset, page: anchor.page }),
      );
    }
  });
});
