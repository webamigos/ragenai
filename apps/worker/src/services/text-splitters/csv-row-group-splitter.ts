import { type Document } from '../../types/Document';
import { packRows } from './pack-rows';

/**
 * CSV row-group splitter (ADR-17).
 *
 * Chunks a CSV document into groups of rows where the **header row is
 * repeated at the top of every chunk**. This preserves column context so
 * retrieval over numeric-heavy tables can match a query like "Q3 revenue"
 * against `Quarter, Revenue\nQ3, 1.2M` instead of just `1.2M`.
 *
 * Also used for XLSX documents: the XLSX loader produces one Document per
 * sheet with sheet_name in metadata, and the dispatcher routes them through
 * this splitter (see split-documents.ts). Sheet-level metadata flows
 * through unchanged.
 *
 * The packing loop moved to `pack-rows.ts` when the table chunker needed the
 * same behaviour; this file keeps everything CSV-specific — the parser, the
 * first-row-is-the-header assumption, and RFC 4180 serialisation.
 *
 * Assumptions:
 * - The first row of the input is the header. If the input has only one
 *   row, the whole thing is returned as a single chunk.
 * - Chunk size is measured in characters (same as other splitters), with
 *   the header row's length always reserved.
 * - If a single body row is itself larger than chunkSize, it is emitted as
 *   its own chunk with the header prepended — oversized but atomic. This
 *   is preferable to splitting a row mid-field and destroying its values.
 * - chunkOverlap is ignored: rows are atomic units and overlapping them
 *   would duplicate data and inflate the reranker input.
 */

export type CsvRowGroupSplitterOptions = {
  /** Target chunk size in characters, including the repeated header row. */
  chunkSize: number;
};

/**
 * Parse a CSV text into rows. Minimal inline parser that handles:
 *   - quoted fields
 *   - escaped double-quotes (`""` → `"`)
 *   - commas inside quoted fields
 *   - embedded newlines inside quoted fields (the `inQuotes` branch appends
 *     every character, including `\n` and `\r`, until the closing quote)
 *   - CRLF and LF line endings
 *
 * Not covered: BOM stripping, alternative delimiters (semicolon, tab),
 * and quote characters other than ASCII double-quote. Upgrade to papaparse
 * if real CSVs start hitting those.
 *
 * Exported for testability.
 */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (next === '"') {
          currentField += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      currentRow.push(currentField);
      currentField = '';
    } else if (char === '\n' || char === '\r') {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      if (char === '\r' && next === '\n') {
        i++; // skip LF after CR
      }
    } else {
      currentField += char;
    }
  }

  // Flush trailing field/row if present
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  // Drop trailing empty rows that result from a final newline
  while (
    rows.length > 0 &&
    rows[rows.length - 1].length === 1 &&
    rows[rows.length - 1][0] === ''
  ) {
    rows.pop();
  }

  return rows;
}

/**
 * Escape a single field for CSV output. Mirrors RFC 4180: wrap in quotes
 * and double-up any existing quotes if the field contains a delimiter,
 * quote, or newline.
 */
function escapeField(field: string): string {
  if (
    field.includes(',') ||
    field.includes('"') ||
    field.includes('\n') ||
    field.includes('\r')
  ) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Serialize a row array to CSV format (single line).
 */
function rowToCsv(row: string[]): string {
  return row.map(escapeField).join(',');
}

/**
 * Serialize multiple rows to CSV text with newlines between them.
 */
function rowsToCsv(rows: string[][]): string {
  return rows.map(rowToCsv).join('\n');
}

/**
 * Split a single CSV document into row-grouped chunks.
 *
 * The packing itself lives in `packRows`, shared with the table chunker — one
 * implementation of "repeat the header, pack to the budget" rather than two.
 * What stays here is everything CSV-specific: parsing the text into rows,
 * deciding that `rows[0]` is the header, and serialising back to RFC 4180.
 */
function splitCsvDocument(
  doc: Document,
  options: CsvRowGroupSplitterOptions,
): Document[] {
  const rows = parseCsvRows(doc.pageContent);
  if (rows.length === 0) {
    return [];
  }

  return packRows({
    // A CSV's header is its first row, by assumption. Docling states which
    // cells are headers instead, which is why the caller supplies them rather
    // than `packRows` deciding.
    headerRows: rows.slice(0, 1),
    bodyRows: rows.slice(1),
    budget: options.chunkSize,
    render: rowsToCsv,
  }).map((pageContent) => ({ pageContent, metadata: { ...doc.metadata } }));
}

/**
 * Public entry point — mirrors the other splitter exports in this package.
 */
export function splitCsvDocuments(
  docs: Document[],
  options: CsvRowGroupSplitterOptions,
): Document[] {
  return docs.flatMap((doc) => splitCsvDocument(doc, options));
}
