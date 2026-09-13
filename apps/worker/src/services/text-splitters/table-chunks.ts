import type { DoclingTable, DoclingTableCell } from '../docling-client';
import type { Document } from '../../types/Document';
import { packRows } from './pack-rows';

/**
 * Tables as their own chunks: taking a table out of the prose, and putting it
 * back as a chunk that repeats its own header.
 *
 * ADR-17 fixed this for CSV *files* and deferred it for tables inside
 * documents (Phase 4c). ADR-20 paused 4c pending a measurement; ADR-43 records
 * why it was delivered on Docling's parse rather than on ADR-18's prompt.
 *
 * **Why the table leaves the markdown.** A table that becomes its own chunk
 * *and* stays in the prose puts the same figures in the index twice. ADR-15's
 * dedupe is an exact `pageContent` match, and a table chunk with repeated
 * headers is a different string from the prose chunk containing the original —
 * so the two are not collapsed. They compete for the same reranker slots and
 * spend the context budget twice on one set of numbers.
 */

/** What `exciseTables` decided, and why. */
export type ExcisionOutcome = {
  /** The markdown to anchor and split. Unchanged when nothing was excised. */
  markdown: string;
  /** Whether every table was taken out. Never partial — see `refusal`. */
  applied: boolean;
  /**
   * Why nothing was excised, when nothing was.
   *
   * Counted and reported beside the pass rate in a benchmark run, because a
   * flat result that came from excision never running is not the same finding
   * as a flat result that came from table chunks not helping. A measurement
   * that cannot tell those apart is not a measurement.
   */
  refusal?: 'no-tables' | 'count-mismatch' | 'content-mismatch';
  /** How many pipe runs the scanner found. */
  candidateCount: number;
  /**
   * The heading stack above each table, by table index — `section_path` for
   * the chunk that replaces it. Only populated when `applied`.
   */
  sectionPaths: (string | undefined)[];
};

/** Collapses the ways one cell's text can be written before comparing. */
function normalizeCell(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** `| --- | :---: |` and friends, which carry no content. */
function isAlignmentRow(cells: string[]): boolean {
  return (
    cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell.trim()))
  );
}

/** Splits one markdown table line into its cells. */
function cellsOf(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

type PipeRun = { start: number; end: number; lines: string[] };

/**
 * Finds runs of consecutive lines that begin with a pipe.
 *
 * Column 0 only. An indented table — inside a list or a blockquote — is not
 * matched and stays in the prose. That is a miss rather than a corruption, and
 * it is the safer half of the trade: a scanner loose enough to catch an
 * indented table is loose enough to catch a quoted one.
 */
function findPipeRuns(markdown: string): PipeRun[] {
  const lines = markdown.split('\n');
  const runs: PipeRun[] = [];
  let current: PipeRun | null = null;

  lines.forEach((line, index) => {
    if (line.startsWith('|')) {
      if (current === null) {
        current = { start: index, end: index, lines: [line] };
      } else {
        current.end = index;
        current.lines.push(line);
      }
      return;
    }
    if (current !== null) {
      runs.push(current);
      current = null;
    }
  });
  if (current !== null) {
    runs.push(current);
  }

  return runs;
}

/** The `#` headings above a line, joined the way ADR-17's `section_path` is. */
function headingStackAt(lines: string[], upTo: number): string | undefined {
  const stack: string[] = [];
  for (let i = 0; i < upTo; i += 1) {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(lines[i]);
    if (!match) {
      continue;
    }
    const level = match[1].length;
    stack.length = Math.min(stack.length, level - 1);
    stack[level - 1] = match[2];
  }
  const path = stack.filter((part) => part !== undefined && part.length > 0);
  return path.length > 0 ? path.join(' > ') : undefined;
}

/** The cells of a Docling table, laid out row by row. */
export function gridOf(table: DoclingTable): string[][] {
  const grid: string[][] = Array.from({ length: table.numRows }, () =>
    Array.from({ length: table.numCols }, () => ''),
  );
  for (const cell of table.cells) {
    if (
      cell.startRow >= 0 &&
      cell.startRow < table.numRows &&
      cell.startCol >= 0 &&
      cell.startCol < table.numCols
    ) {
      grid[cell.startRow][cell.startCol] = cell.text;
    }
  }
  return grid;
}

/** Which rows Docling flagged as holding column names. */
function headerRowIndices(table: DoclingTable): Set<number> {
  const rows = new Set<number>();
  for (const cell of table.cells) {
    if (cell.columnHeader) {
      rows.add(cell.startRow);
    }
  }
  return rows;
}

/**
 * Does a pipe run describe the table it was paired with?
 *
 * **Equal counts are not proof of a correct pairing**, and this is the guard
 * that matters. A fenced code block containing a markdown table, or prose
 * lines that happen to start with a pipe, produce runs the scanner cannot tell
 * from a real table. Combine that with the mismatch this already expects —
 * Docling's serialiser emitting an HTML `<table>` for some merged-cell tables
 * — and the two errors cancel in the count while the pairing is wrong from
 * that point on. The document then loses a prose block, and the text removed
 * in its place is filed under a table it never belonged to. That is silent
 * data loss, which is the one outcome this exists to prevent.
 *
 * Cheap, because both sides are already parsed.
 */
function runMatchesTable(run: PipeRun, table: DoclingTable): boolean {
  const contentRows = run.lines
    .map(cellsOf)
    .filter((cells) => !isAlignmentRow(cells));

  if (contentRows.length !== table.numRows) {
    return false;
  }
  const grid = gridOf(table);
  for (let r = 0; r < table.numRows; r += 1) {
    if (contentRows[r].length !== table.numCols) {
      return false;
    }
    for (let c = 0; c < table.numCols; c += 1) {
      if (normalizeCell(contentRows[r][c]) !== normalizeCell(grid[r][c])) {
        return false;
      }
    }
  }
  return true;
}

/**
 * The line that stands in for a table in the prose.
 *
 * Docling's caption where it has one; both backends this ships against report
 * `captions: []`, so the ordinal is the case that actually runs. The prose
 * keeps a referent either way, and the figures live in exactly one chunk.
 */
export function tablePlaceholder(table: DoclingTable, index: number): string {
  return table.caption
    ? `[Table ${index + 1}: ${table.caption}]`
    : `[Table ${index + 1}]`;
}

/**
 * Takes every table out of the markdown, or takes none out.
 *
 * **All-or-nothing is deliberate.** A partial excision means the mapping is
 * unsound somewhere, and excising the rest on the assumption that the failure
 * was isolated is how the wrong block gets deleted. One HTML-serialised table
 * in a twenty-table document disables excision for that whole document — which
 * is the right call, and the reason the refusal is counted rather than
 * swallowed.
 */
export function exciseTables(
  markdown: string,
  tables: DoclingTable[],
): ExcisionOutcome {
  const runs = findPipeRuns(markdown);

  if (tables.length === 0) {
    return {
      markdown,
      applied: false,
      refusal: 'no-tables',
      candidateCount: runs.length,
      sectionPaths: [],
    };
  }

  if (runs.length !== tables.length) {
    return {
      markdown,
      applied: false,
      refusal: 'count-mismatch',
      candidateCount: runs.length,
      sectionPaths: [],
    };
  }

  // Every candidate is validated before anything is removed.
  for (let i = 0; i < runs.length; i += 1) {
    if (!runMatchesTable(runs[i], tables[i])) {
      return {
        markdown,
        applied: false,
        refusal: 'content-mismatch',
        candidateCount: runs.length,
        sectionPaths: [],
      };
    }
  }

  const lines = markdown.split('\n');
  const sectionPaths = runs.map((run) => headingStackAt(lines, run.start));

  // Replaced back to front, so an earlier replacement does not move the line
  // numbers of a later run.
  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    lines.splice(
      run.start,
      run.end - run.start + 1,
      tablePlaceholder(tables[i], i),
    );
  }

  return {
    markdown: lines.join('\n'),
    applied: true,
    candidateCount: runs.length,
    sectionPaths,
  };
}

/**
 * One chunk of a table, in the camelCase intermediate shape `prepareMetadata`
 * maps to the Qdrant payload.
 *
 * A `Document` at the type level, so table chunks and prose chunks flow
 * through the pipeline as one array rather than as a union nothing downstream
 * knows how to narrow. The metadata shape is documented here instead.
 */
export type TableChunk = Document<{
  chunk_type: 'table';
  sectionPath?: string;
  sourcePage?: number;
}>;

/** Renders rows back to markdown pipes. */
function renderPipes(rows: string[][], headerCount: number): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const out = rows.slice(0, headerCount).map(line);
  if (headerCount > 0 && rows.length > 0) {
    out.push(`| ${rows[0].map(() => '---').join(' | ')} |`);
  }
  out.push(...rows.slice(headerCount).map(line));
  return out.join('\n');
}

/**
 * Turns one parsed table into chunks, repeating its header in each.
 *
 * **Markdown pipes, not CSV.** The surrounding chunks are markdown, Docling's
 * own serialiser emits pipes, and a reader following a citation to a table
 * chunk sees a table rather than a comma soup. Emitting CSV would put a second
 * syntax inside a markdown corpus for no retrieval benefit — a
 * retrieval-affecting choice, which is why it is stated here rather than left
 * to whoever writes the renderer.
 *
 * A table with no `column_header` cell is emitted with no repetition.
 * Repeating an arbitrary first row is worse than repeating nothing, because it
 * reads as authoritative.
 *
 * Merged cells are flattened: a two-level header renders as one line and some
 * column meaning is lost. Better than no header, worse than the original.
 */
export function buildTableChunks(
  table: DoclingTable,
  index: number,
  options: { budget: number; sectionPath?: string },
): Document[] {
  const grid = gridOf(table);
  const headerRows = headerRowIndices(table);
  // Leading header rows only. A `column_header` flag deeper in the table is
  // not a header this can repeat — repeating a mid-table row above the rows
  // that precede it would state something the document does not.
  let headerCount = 0;
  while (headerCount < grid.length && headerRows.has(headerCount)) {
    headerCount += 1;
  }

  const header = grid.slice(0, headerCount);
  const body = grid.slice(headerCount);

  const rendered = packRows({
    headerRows: header,
    bodyRows: body,
    budget: options.budget,
    render: (rows) => renderPipes(rows, Math.min(headerCount, rows.length)),
  });

  const caption = tablePlaceholder(table, index);

  return rendered.map((pageContent) => ({
    // The placeholder leads the chunk, so a table chunk and the prose that
    // refers to it share a string a reader can follow.
    pageContent: `${caption}\n${pageContent}`,
    metadata: {
      chunk_type: 'table' as const,
      ...(options.sectionPath !== undefined
        ? { sectionPath: options.sectionPath }
        : {}),
      // Straight from `tables[i].prov[0].page_no`. Without it the table chunk
      // loses the "· page {n}" the UI shows on exactly the content this work
      // exists to make findable — the markdown chunk it used to live in got a
      // page from `attachSourcePages`, and a chunk produced outside that path
      // would silently get none.
      ...(table.page !== undefined ? { sourcePage: table.page } : {}),
    },
  }));
}

export type { DoclingTableCell };
