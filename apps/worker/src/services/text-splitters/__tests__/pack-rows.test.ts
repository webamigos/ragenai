import { packRows } from '../pack-rows';

/**
 * The shared packing core.
 *
 * `csv-row-group-splitter.spec.ts` is the proof that extracting this preserved
 * behaviour — those tests are unchanged and still pass. What is here is the
 * cases the CSV splitter cannot reach, because the table chunker can: no
 * header at all, several header rows, and a renderer that is not CSV.
 */
const joinRows = (rows: string[]) => rows.join('\n');

describe('packRows', () => {
  it('repeats the header at the top of every chunk', () => {
    // ADR-17's finding in one assertion: without this, chunk 2 is rows of
    // numbers with no column names.
    const chunks = packRows({
      headerRows: ['Kwartał,Przychód'],
      bodyRows: ['Q1,1200000', 'Q2,1350000', 'Q3,1180000', 'Q4,1490000'],
      budget: 40,
      render: joinRows,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('Kwartał,Przychód\n')).toBe(true);
    }
  });

  it('keeps every body row exactly once across the chunks', () => {
    const body = Array.from({ length: 30 }, (_, i) => `row-${i},${i * 137}`);

    const chunks = packRows({
      headerRows: ['id,value'],
      bodyRows: body,
      budget: 60,
      render: joinRows,
    });

    const emitted = chunks
      .flatMap((chunk) => chunk.split('\n'))
      .filter((line) => line !== 'id,value');
    expect(emitted).toEqual(body);
  });

  it('packs to the budget rather than one row per chunk', () => {
    const chunks = packRows({
      headerRows: ['h'],
      bodyRows: ['a', 'b', 'c', 'd', 'e', 'f'],
      budget: 100,
      render: joinRows,
    });

    expect(chunks).toEqual(['h\na\nb\nc\nd\ne\nf']);
  });

  it('emits a row wider than the budget whole, over budget', () => {
    // Splitting a row mid-field destroys its values, which is worse than a
    // chunk that is too long. The same concession the CSV splitter has always
    // made, now in one place.
    const wide = 'x'.repeat(500);

    const chunks = packRows({
      headerRows: ['h'],
      bodyRows: ['a', wide, 'b'],
      budget: 20,
      render: joinRows,
    });

    expect(chunks).toContain(`h\n${wide}`);
    expect(chunks.join('\n')).toContain(wide);
  });

  it('works with no header at all', () => {
    // A Docling table with no `column_header` cell. Repeating an arbitrary
    // first row would be worse than repeating nothing, because it reads as
    // authoritative — so the caller passes none and this must cope.
    const chunks = packRows({
      headerRows: [],
      bodyRows: ['a', 'b', 'c'],
      budget: 4,
      render: joinRows,
    });

    expect(chunks.join('\n').split('\n')).toEqual(['a', 'b', 'c']);
    expect(chunks.every((chunk) => !chunk.startsWith('\n'))).toBe(true);
  });

  it('repeats several header rows when a table has them', () => {
    const chunks = packRows({
      headerRows: ['Grupa,Grupa', 'Kwartał,Przychód'],
      bodyRows: ['Q1,1200000', 'Q2,1350000', 'Q3,1180000'],
      budget: 45,
      render: joinRows,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('Grupa,Grupa\nKwartał,Przychód\n')).toBe(true);
    }
  });

  it('returns the header alone when there is no body', () => {
    expect(
      packRows({
        headerRows: ['h1', 'h2'],
        bodyRows: [],
        budget: 10,
        render: joinRows,
      }),
    ).toEqual(['h1\nh2']);
  });

  it('returns nothing for nothing', () => {
    expect(
      packRows({
        headerRows: [],
        bodyRows: [],
        budget: 10,
        render: joinRows,
      }),
    ).toEqual([]);
  });

  it('sizes on the rendered output, not on the rows', () => {
    // The same cells are different lengths as CSV and as a markdown table row.
    // A budget measured on the wrong rendering is not a budget.
    const rows = [
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
    ];
    const asPipes = (r: string[][]) =>
      r.map((cells) => `| ${cells.join(' | ')} |`).join('\n');

    const chunks = packRows({
      headerRows: [['h1', 'h2']],
      bodyRows: rows,
      budget: 30,
      render: asPipes,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('| h1 | h2 |\n')).toBe(true);
    }
  });
});
