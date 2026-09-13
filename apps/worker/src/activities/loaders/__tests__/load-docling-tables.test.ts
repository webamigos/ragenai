/**
 * A table's trip from `json_content` to the splitter.
 *
 * `convertWithDocling` is the only place the structured document exists.
 * `loadDocling` never sees it, and `splitText` runs two modules further on, so
 * widening the client's return type is necessary and not sufficient: without a
 * transport there is nowhere for the table chunker to read a table from.
 *
 * The channel is the one `doclingPageAnchors` already established —
 * `doc.metadata`, spread conditionally. This asserts a table survives the trip
 * and that nothing else on the way changes: same markdown, same page count,
 * same anchors, and no key at all on a document with no tables.
 *
 * Nothing consumes the tables yet. The transport is tested on its own because
 * it lands on its own.
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('bytes')),
}));
jest.mock('../../../services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../../../services/ensure-local-file', () => ({
  ensureLocalFile: jest.fn().mockResolvedValue('/tmp/f.md'),
}));

import { readFileSync } from 'fs';
import { join } from 'path';

process.env.FEATURE_FLAG_TABLE_CHUNKS = '1';

import { loadDocling } from '../load-docling';
import { FileType } from '../../../types/UserFile';
import type {
  DoclingElementLabels,
  DoclingTable,
} from '../../../services/docling-client';

const fixture = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '../../../services/__tests__/fixtures/docling-markdown-table.json',
    ),
    'utf8',
  ),
) as {
  document: { md_content: string; json_content: Record<string, unknown> };
};

const respond = (document: Record<string, unknown>) => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', document, errors: [] }),
  });
};

const load = () =>
  loadDocling({
    orgId: 'org-1',
    fileId: 'file-1',
    fileName: 'tabela.md',
    fileType: FileType.MARKDOWN,
  });

/**
 * The tables reach `doc.metadata` **only when the excision ran**, so these
 * cases need the flag on.
 *
 * That gate is not incidental. After a refusal — or with the flag off — the
 * tables are still in the prose, and putting them on the metadata as well
 * would let the splitter emit table chunks beside prose chunks holding the
 * same figures. ADR-15's dedupe is an exact `pageContent` match and would not
 * collapse the two.
 *
 * `TABLE_CHUNKS_ENABLED` is read at module load, which is why the environment
 * is set before the modules are required rather than per test.
 */
beforeAll(() => {
  process.env.FEATURE_FLAG_TABLE_CHUNKS = '1';
});

afterAll(() => {
  delete process.env.FEATURE_FLAG_TABLE_CHUNKS;
});

beforeEach(() => {
  mockFetch.mockReset();
});

describe('a table reaching the splitter', () => {
  it('arrives on doc.metadata with its header cells flagged', async () => {
    respond(fixture.document);

    const [doc] = await load();
    const tables = doc.metadata.doclingTables as DoclingTable[];

    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      selfRef: '#/tables/0',
      numRows: 4,
      numCols: 4,
    });
    // The whole reason the tables are carried: the parser states which row
    // holds the column names, so the row-group strategy needs no heuristic.
    const header = tables[0].cells
      .filter((cell) => cell.columnHeader)
      .map((cell) => cell.text);
    expect(header).toEqual([
      'Kategoria sprzetu',
      'Limit brutto',
      'Okres rozliczeniowy',
      'Numer zalacznika',
    ]);
  });

  it('renames the payload to the loader convention at this boundary', async () => {
    // camelCase here, snake_case only where `prepareMetadata` writes to
    // Qdrant — the contract ADR-17 set for `sectionPath` and `sheetName`.
    respond(fixture.document);

    const [doc] = await load();
    const [table] = doc.metadata.doclingTables as DoclingTable[];

    expect(Object.keys(table.cells[0]).sort()).toEqual([
      'colSpan',
      'columnHeader',
      'rowSpan',
      'startCol',
      'startRow',
      'text',
    ]);
  });

  it('carries the element labels alongside', async () => {
    respond(fixture.document);

    const [doc] = await load();
    const labels = doc.metadata.doclingElementLabels as DoclingElementLabels;

    expect(labels.table).toBe(1);
    // The document's own heading and its two paragraphs, counted by label.
    // Nothing acts on these: dropping `page_header` and `page_footer` before
    // they reach a chunk is a second change to chunk content and owes its own
    // measurement.
    expect(labels).toEqual({ title: 1, text: 2, table: 1 });
  });

  it('hands on the post-excision markdown, with the table replaced by a marker', async () => {
    // With the flag on, the markdown the splitter receives is the one the
    // table has left. Byte-identity is the flag-*off* claim and is owned by
    // `services/__tests__/table-chunks-flag-off.test.ts`.
    respond(fixture.document);

    const [doc] = await load();

    expect(doc.pageContent).toContain('[Table 1]');
    expect(doc.pageContent).not.toContain('Monitor zewnetrzny');
    // The prose either side of it is untouched, so it still reads as a
    // document rather than as a hole.
    expect(doc.pageContent).toContain('# Regulamin zwrotow kosztow');
    expect(doc.pageContent).toContain('Wnioski rozpatruje Dzial Zaopatrzenia.');
    // A markdown source is not paginated, so there is no page count and no
    // anchor — the same as before any of this.
    expect('doclingPageCount' in doc.metadata).toBe(false);
    expect('doclingPageAnchors' in doc.metadata).toBe(false);
  });

  it('carries no key at all for a document with no tables', async () => {
    // Conditional spread, like its neighbours. An empty array on every
    // document would be a claim that the parser looked and found none, and it
    // would change the metadata of every existing ingest.
    respond({
      md_content: 'Zwykły akapit bez tabeli.',
      json_content: {
        texts: [{ text: 'Zwykły akapit bez tabeli.', label: 'text', prov: [] }],
      },
    });

    const [doc] = await load();

    expect('doclingTables' in doc.metadata).toBe(false);
    expect(doc.metadata.doclingElementLabels).toEqual({ text: 1 });
  });

  it('carries no key when the structured document could not be read', async () => {
    // The markdown is the part ingest cannot do without; a malformed
    // `json_content` costs the tables and nothing else.
    respond({ md_content: '# Tytuł', json_content: '{not json' });

    const [doc] = await load();

    expect(doc.pageContent).toBe('# Tytuł');
    expect('doclingTables' in doc.metadata).toBe(false);
    expect('doclingElementLabels' in doc.metadata).toBe(false);
  });

  it('reads the page of a table that has one, without touching the anchor walk', async () => {
    // `tables[i].prov[0].page_no` uses no shared cursor, which is why reading
    // it here does not break the invariant that keeps the text walk's offsets
    // stable. A spreadsheet is the case that has one.
    const spreadsheet = JSON.parse(
      readFileSync(
        join(
          __dirname,
          '../../../services/__tests__/fixtures/docling-spreadsheet.json',
        ),
        'utf8',
      ),
    ) as { document: Record<string, unknown> };
    respond(spreadsheet.document);

    const [doc] = await load();
    const [table] = doc.metadata.doclingTables as DoclingTable[];

    expect(table.page).toBe(1);
  });

  it('leaves the page off a table from an unpaginated source', async () => {
    respond(fixture.document);

    const [doc] = await load();
    const [table] = doc.metadata.doclingTables as DoclingTable[];

    // `prov: []` on a markdown table, confirmed by the parser contract test.
    // Absent rather than defaulted: the table chunk gets no `source_page`,
    // which is the existing discriminator.
    expect('page' in table).toBe(false);
  });
});

describe('and with the flag off', () => {
  it('carries no tables at all, whatever the document holds', async () => {
    // Every deployment today. The transport exists; what the flag gates is
    // whether the tables leave the markdown and become chunks — and putting
    // them on the metadata without excising them is exactly the duplication
    // this arrangement avoids.
    const previous = process.env.FEATURE_FLAG_TABLE_CHUNKS;
    delete process.env.FEATURE_FLAG_TABLE_CHUNKS;
    respond(fixture.document);
    try {
      let docs!: Promise<Awaited<ReturnType<typeof loadDocling>>>;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('../load-docling') as {
          loadDocling: typeof loadDocling;
        };
        docs = mod.loadDocling({
          orgId: 'org-1',
          fileId: 'file-1',
          fileName: 'tabela.md',
          fileType: FileType.MARKDOWN,
        });
      });
      const [doc] = await docs;

      expect('doclingTables' in doc.metadata).toBe(false);
      expect(doc.pageContent).toBe(fixture.document.md_content);
    } finally {
      if (previous !== undefined) {
        process.env.FEATURE_FLAG_TABLE_CHUNKS = previous;
      }
    }
  });
});
