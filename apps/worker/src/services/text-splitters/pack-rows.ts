/**
 * Group rows into chunks, repeating the header at the top of each one.
 *
 * ADR-17's whole finding in one function: the header row appeared only in the
 * first chunk, so chunks 2, 3, 4 were rows of numbers with no column names and
 * a query for "Q3 revenue" had to match `1,200,000` with nothing nearby saying
 * the column means revenue.
 *
 * Extracted from `csv-row-group-splitter.ts` when the table chunker needed the
 * same behaviour. The CSV splitter as it stood was **not** reusable: it takes a
 * `Document` whose `pageContent` is CSV *text*, parses it, assumes `rows[0]` is
 * the header and serialises back to comma-joined fields. Docling gives
 * structured cells with header flags, possibly no header row and possibly
 * several. What is genuinely shared is the packing loop, so that is what moved,
 * and the CSV splitter was rewritten onto it rather than left as a second copy.
 *
 * Two deliberate concessions, both inherited:
 *
 * - **`chunkOverlap` has no meaning here.** Rows are atomic; overlapping them
 *   would duplicate data and inflate the reranker's input.
 * - **A single row wider than the budget is emitted whole, over budget.**
 *   Splitting a row mid-field destroys its values, which is worse than a chunk
 *   that is too long.
 */

export type PackRowsOptions<Row> = {
  /** Rows repeated at the top of every chunk. Empty is allowed and means none. */
  headerRows: Row[];
  bodyRows: Row[];
  /** Target chunk size in characters, including the repeated header. */
  budget: number;
  /** How a group of rows becomes the text of one chunk. */
  render: (rows: Row[]) => string;
};

/**
 * Returns one string per chunk, each already rendered.
 *
 * Sizing is done on the rendered output rather than on the rows, because only
 * the caller knows how a row becomes text — a CSV row and a markdown table row
 * of the same cells are different lengths, and a budget measured on the wrong
 * one is not a budget.
 */
export function packRows<Row>({
  headerRows,
  bodyRows,
  budget,
  render,
}: PackRowsOptions<Row>): string[] {
  if (bodyRows.length === 0) {
    // Header only, or nothing at all. A header with no body is still a chunk:
    // it is what the document contains.
    return headerRows.length > 0 ? [render(headerRows)] : [];
  }

  const headerSize = headerRows.length > 0 ? render(headerRows).length + 1 : 0;

  const chunks: string[] = [];
  let currentBody: Row[] = [];
  let currentSize = headerSize;

  const flush = () => {
    if (currentBody.length === 0) {
      return;
    }
    chunks.push(render([...headerRows, ...currentBody]));
    currentBody = [];
    currentSize = headerSize;
  };

  for (const row of bodyRows) {
    // +1 for the newline this row adds when it is joined to the ones above.
    const rowSize = render([row]).length + 1;

    // Flush before adding, not after: a chunk that is already at the budget
    // must not take one more row, and a chunk with nothing in it must take
    // this row however large it is, or the row is never emitted at all.
    if (currentBody.length > 0 && currentSize + rowSize > budget) {
      flush();
    }

    currentBody.push(row);
    currentSize += rowSize;
  }

  flush();

  return chunks;
}
