/**
 * What Docling says about a table, on the two backends the table-chunk work
 * runs against.
 *
 * `column_header` is the whole design of the row-group strategy: it says which
 * row to repeat at the top of every chunk instead of leaving a heuristic to
 * guess. The [tables spec](../../../../../docs/specs/2026-09-12-tables-as-their-own-chunks.md)
 * verified it on Docling's **HTML** backend only — and Docling uses a different
 * table parser per input format. If a markdown or spreadsheet source did not
 * set the flag, every table would fall into the "no column header" branch, the
 * feature would quietly no-op, and the benchmark in Phase C would read flat for
 * a reason the spec had already pre-labelled acceptable.
 *
 * So A1 is this test, before any of it is built. Both fixtures are real
 * `/v1/convert/source` responses from `docling-serve-cpu:v1.32.0`, recorded
 * verbatim apart from `processing_time`, `timings` and `confidence`:
 *
 * - `docling-markdown-table.json` — `tabela-limitow.md` beside it, the format
 *   the Phase A corpus is written in;
 * - `docling-spreadsheet.json` — the e2e XLSX fixture, one of the two file
 *   types the flag changes by side effect.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

type TableCell = {
  text: string;
  column_header: boolean;
  row_header: boolean;
  row_span: number;
  col_span: number;
  start_row_offset_idx: number;
  end_row_offset_idx: number;
  start_col_offset_idx: number;
  end_col_offset_idx: number;
  bbox: unknown;
};
type Table = {
  self_ref: string;
  label: string;
  captions: unknown[];
  prov: Array<{ page_no: number; bbox: Record<string, unknown> }>;
  data: {
    table_cells: TableCell[];
    num_rows: number;
    num_cols: number;
    grid: unknown[][];
  };
};
type DoclingDocument = {
  version: string;
  texts: unknown[];
  tables: Table[];
  pages: Record<string, { size: { width: number; height: number } }>;
};

const load = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as {
    document: { md_content: string; json_content: DoclingDocument };
  };

const markdown = load('docling-markdown-table.json');
const spreadsheet = load('docling-spreadsheet.json');

const headerRowOf = (table: Table) =>
  table.data.table_cells
    .filter((cell) => cell.column_header)
    .map((cell) => cell.text);

describe.each([
  ['the markdown backend', markdown],
  ['the spreadsheet backend', spreadsheet],
])('%s', (_name, fixture) => {
  const doc = fixture.document.json_content;

  it('parses the table into `tables`, not into the text stream', () => {
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0].label).toBe('table');
    expect(doc.tables[0].self_ref).toMatch(/^#\/tables\/\d+$/);
  });

  it('states the grid size', () => {
    const { data } = doc.tables[0];
    expect(data.num_rows).toBeGreaterThan(1);
    expect(data.num_cols).toBeGreaterThan(1);
    expect(data.table_cells.length).toBe(data.num_rows * data.num_cols);
  });

  it('flags the header cells rather than leaving a heuristic to guess', () => {
    // The load-bearing assertion. Without this the row-group strategy has no
    // row to repeat, and repeating an arbitrary first row is worse than
    // repeating nothing because it reads as authoritative.
    const header = headerRowOf(doc.tables[0]);
    expect(header.length).toBe(doc.tables[0].data.num_cols);
    for (const text of header) {
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it('puts the header cells in the first row and nowhere else', () => {
    for (const cell of doc.tables[0].data.table_cells) {
      expect(cell.column_header).toBe(cell.start_row_offset_idx === 0);
    }
  });

  it('gives every cell a span, so a merged cell is recognisable', () => {
    for (const cell of doc.tables[0].data.table_cells) {
      expect(cell.row_span).toBeGreaterThanOrEqual(1);
      expect(cell.col_span).toBeGreaterThanOrEqual(1);
    }
  });

  it('serialises the table as pipes in the markdown', () => {
    // The excision pass scans for runs of lines beginning with `|`. Docling's
    // markdown serialiser emitting an HTML `<table>` instead is the expected
    // cause of a refusal, and both of these are the pipe case.
    const lines = fixture.document.md_content.split('\n');
    const pipeRuns = lines.filter((line) => line.trimStart().startsWith('|'));
    expect(pipeRuns.length).toBe(doc.tables[0].data.num_rows + 1);
    expect(fixture.document.md_content).not.toMatch(/<table/i);
  });

  it('pads cells, so a content check has to normalise whitespace', () => {
    // `| Monitor zewnetrzny  | 2 847 zl       |` — the serialiser aligns
    // columns and right-aligns numeric ones. Comparing a run's cells against
    // `table_cells` verbatim would refuse every valid pairing.
    expect(fixture.document.md_content).toMatch(/\|\s{2,}\S|\S\s{2,}\|/);
  });
});

describe('what differs between the two backends', () => {
  it('gives a markdown table no provenance at all', () => {
    // Confirmed, and the reason `source_page` on a table chunk is absent
    // rather than defaulted: a markdown source has no pages.
    expect(markdown.document.json_content.tables[0].prov).toEqual([]);
    expect(markdown.document.json_content.pages).toEqual({});
  });

  it('gives a spreadsheet table a page whose size is a cell grid, not points', () => {
    // 7 by 6 — columns and rows. Anything that normalises a box against this
    // page size produces a fraction of a spreadsheet, which is meaningless.
    // Harmless today only because a spreadsheet has no `texts` at all, so the
    // provenance walk produces nothing to normalise.
    const doc = spreadsheet.document.json_content;
    expect(doc.pages['1'].size).toEqual({ width: 7, height: 6 });
    expect(doc.texts).toEqual([]);
    expect(doc.tables[0].prov[0].page_no).toBe(1);
    // And it reports top-left here, where the PDF reported bottom-left — the
    // flag is read per box, never assumed.
    expect(doc.tables[0].prov[0].bbox.coord_origin).toBe('TOPLEFT');
  });

  it('offers no caption on either, so a placeholder needs a fallback', () => {
    expect(markdown.document.json_content.tables[0].captions).toEqual([]);
    expect(spreadsheet.document.json_content.tables[0].captions).toEqual([]);
  });

  it('turns a whole spreadsheet into one table', () => {
    // Which is why the flag changes a spreadsheet's chunking completely rather
    // than marginally, and why the Phase A corpus includes one.
    expect(spreadsheet.document.json_content.tables).toHaveLength(1);
    expect(
      spreadsheet.document.md_content
        .split('\n')
        .filter((line) => line.trim().length > 0 && !line.startsWith('|')),
    ).toEqual([]);
  });
});
