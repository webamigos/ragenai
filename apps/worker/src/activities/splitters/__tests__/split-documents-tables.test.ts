/**
 * What ingest actually produces, once a table has been taken out of the prose.
 *
 * The unit tests cover the excision and the chunk building on their own. This
 * is the coupling nothing else would catch: the anchors are built on the
 * post-excision markdown and the chunks are cut from the same string, so a
 * page assigned to a chunk has to still describe where that chunk's text came
 * from. Building the excision beside the splitter — the natural place — would
 * anchor one string and cut another, and every element after the first table
 * would get the wrong page.
 */
jest.mock('../../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { splitText } from '../split-documents';
import { exciseTables } from '../../../services/text-splitters/table-chunks';
import { FileType } from '../../../types/UserFile';
import type { Document } from '../../../types/Document';
import type {
  DoclingTable,
  DoclingTableCell,
} from '../../../services/docling-client';

const cell = (
  text: string,
  row: number,
  col: number,
  columnHeader = false,
): DoclingTableCell => ({
  text,
  columnHeader,
  rowSpan: 1,
  colSpan: 1,
  startRow: row,
  startCol: col,
});

const GRID = [
  ['Kod', 'Nazwa', 'Limit'],
  ...Array.from({ length: 25 }, (_, i) => [
    `CD-${1104 + i * 23}`,
    `Pozycja ${i}`,
    `${1000 + i},50`,
  ]),
];

const TABLE: DoclingTable = {
  selfRef: '#/tables/0',
  numRows: GRID.length,
  numCols: 3,
  cells: GRID.flatMap((row, r) =>
    row.map((text, c) => cell(text, r, c, r === 0)),
  ),
  page: 2,
};

const TABLE_MARKDOWN = [
  `| ${GRID[0].join(' | ')} |`,
  '| --- | --- | --- |',
  ...GRID.slice(1).map((row) => `| ${row.join(' | ')} |`),
].join('\n');

const ORIGINAL = [
  '# Regulamin',
  '',
  '## Limity',
  '',
  'Poniższa tabela określa limity kwotowe obowiązujące w spółce.',
  '',
  TABLE_MARKDOWN,
  '',
  'Wnioski rozpatruje Dział Zaopatrzenia w terminie 11 dni roboczych.',
].join('\n');

const SETTINGS = { chunkSize: 400, chunkOverlap: 80 };

const split = (rawDocs: Document[]) =>
  splitText({
    fileType: FileType.MARKDOWN,
    rawDocs,
    splitterSettings: SETTINGS,
    parsedWithDocling: true,
  });

/** The document as `loadDocling` would build it, after an excision. */
const afterExcision = (): Document => {
  const outcome = exciseTables(ORIGINAL, [TABLE]);
  expect(outcome.applied).toBe(true);
  return {
    pageContent: outcome.markdown,
    metadata: {
      fileName: 'regulamin.md',
      doclingTables: [
        outcome.sectionPaths[0] !== undefined
          ? { ...TABLE, sectionPath: outcome.sectionPaths[0] }
          : TABLE,
      ],
    },
  };
};

/** The same document with the flag off: table still in the prose, no key. */
const withoutExcision = (): Document => ({
  pageContent: ORIGINAL,
  metadata: { fileName: 'regulamin.md' },
});

describe('splitText — Docling with table chunks', () => {
  it('emits the prose chunks and the table chunks', async () => {
    const chunks = await split([afterExcision()]);

    const tableChunks = chunks.filter(
      (chunk) => chunk.metadata.chunk_type === 'table',
    );
    const proseChunks = chunks.filter(
      (chunk) => chunk.metadata.chunk_type !== 'table',
    );

    expect(proseChunks.length).toBeGreaterThan(0);
    expect(tableChunks.length).toBeGreaterThan(1);
  });

  it('repeats the column names in every table chunk', async () => {
    // The whole point. Without it, chunks 2 and 3 are rows of numbers and a
    // query for a limit has to match `1012,50` with nothing nearby saying the
    // column means limit.
    const chunks = await split([afterExcision()]);

    for (const chunk of chunks.filter(
      (c) => c.metadata.chunk_type === 'table',
    )) {
      expect(chunk.pageContent).toContain('| Kod | Nazwa | Limit |');
    }
  });

  it('keeps the figures out of the prose chunks', async () => {
    // The table left the markdown, so the same numbers are not in the index
    // twice. ADR-15's dedupe is an exact string match and would not have
    // collapsed them.
    const chunks = await split([afterExcision()]);

    const prose = chunks
      .filter((chunk) => chunk.metadata.chunk_type !== 'table')
      .map((chunk) => chunk.pageContent)
      .join('\n');

    expect(prose).toContain('[Table 1]');
    expect(prose).not.toContain('1012,50');
    expect(prose).toContain('Wnioski rozpatruje Dział Zaopatrzenia');
  });

  it('gives the table chunks the page and section the table had', async () => {
    const chunks = await split([afterExcision()]);

    for (const chunk of chunks.filter(
      (c) => c.metadata.chunk_type === 'table',
    )) {
      expect(chunk.metadata.sourcePage).toBe(2);
      expect(chunk.metadata.sectionPath).toBe('Regulamin > Limity');
    }
  });

  it('locates every prose chunk in the string it was cut from', async () => {
    // The ordering coupling. Anchors are built on the post-excision markdown
    // inside `convertWithDocling`; the chunks are cut from the same string
    // here. If the two ever diverged, a chunk would not be findable in the
    // text its page was derived from.
    const doc = afterExcision();
    const chunks = await split([doc]);

    for (const chunk of chunks.filter(
      (c) => c.metadata.chunk_type !== 'table',
    )) {
      expect(doc.pageContent).toContain(chunk.pageContent.trim().slice(0, 60));
    }
  });

  it('emits no table chunk when the excision did not run', async () => {
    // `loadDocling` withholds `doclingTables` after a refusal and with the
    // flag off, so this is what every deployment gets today.
    const chunks = await split([withoutExcision()]);

    expect(chunks.some((chunk) => chunk.metadata.chunk_type === 'table')).toBe(
      false,
    );
    expect(chunks.map((c) => c.pageContent).join('\n')).toContain('1012,50');
  });

  it('produces the same prose chunks with and without the tables key', async () => {
    // The emission adds chunks; it does not move the ones that were already
    // there. Compared against the same post-excision markdown with the
    // metadata key withheld, so the only difference under test is the
    // emission itself.
    const doc = afterExcision();
    const withTables = await split([doc]);
    const withoutTables = await split([
      { pageContent: doc.pageContent, metadata: { fileName: 'regulamin.md' } },
    ]);

    expect(withTables.filter((c) => c.metadata.chunk_type !== 'table')).toEqual(
      withoutTables,
    );
  });
});

describe('the transport does not ride on every chunk', () => {
  it('strips the Docling keys the loader used to reach this module', async () => {
    // The splitter copies a document's metadata onto every chunk it cuts, so
    // without this the whole parsed table — every cell of a sixty-row
    // schedule — travels on each of the document's chunks across the activity
    // boundary, and again on the way to `prepareMetadata`, which drops them
    // all. `doclingPageAnchors` has always done this at a smaller scale;
    // tables make it an order of magnitude worse, and Temporal has a payload
    // limit a long document could reach.
    const chunks = await split([afterExcision()]);

    for (const chunk of chunks) {
      expect('doclingTables' in chunk.metadata).toBe(false);
      expect('doclingPageAnchors' in chunk.metadata).toBe(false);
      expect('doclingElementLabels' in chunk.metadata).toBe(false);
      expect('doclingPageCount' in chunk.metadata).toBe(false);
    }
  });

  it('strips them on a document with no tables too', async () => {
    const chunks = await split([
      {
        pageContent: ORIGINAL,
        metadata: {
          fileName: 'regulamin.md',
          doclingPageCount: 3,
          doclingPageAnchors: [{ offset: 0, page: 1 }],
        },
      },
    ]);

    for (const chunk of chunks) {
      expect('doclingPageAnchors' in chunk.metadata).toBe(false);
      expect('doclingPageCount' in chunk.metadata).toBe(false);
    }
    // And the page it derived from those anchors survives, which is the point
    // of keeping them long enough to read.
    expect(chunks[0].metadata.sourcePage).toBe(1);
  });

  it('keeps what the chunk is actually about', async () => {
    const chunks = await split([afterExcision()]);

    expect(chunks[0].metadata.fileName).toBe('regulamin.md');
  });
});
