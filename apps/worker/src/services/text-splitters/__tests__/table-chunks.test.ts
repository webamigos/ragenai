import {
  buildTableChunks,
  exciseTables,
  tablePlaceholder,
} from '../table-chunks';
import type { DoclingTable, DoclingTableCell } from '../../docling-client';

/**
 * Taking a table out of the prose, and putting it back as its own chunk.
 *
 * The dangerous half is the excision, and the dangerous case is not a count
 * mismatch — it is **equal counts with a wrong pairing**. One table serialised
 * as HTML removes a pipe run while a fenced code block containing a markdown
 * table adds one back; the counts agree, the mapping is wrong from that point
 * on, and the document loses a prose block whose text is filed under a table it
 * never belonged to. That is silent data loss and it has a test below.
 */
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

/** A table from a grid of strings; the first row is the header unless told otherwise. */
const table = (
  grid: string[][],
  options: {
    headerRows?: number;
    caption?: string;
    page?: number;
    selfRef?: string;
  } = {},
): DoclingTable => {
  const headerRows = options.headerRows ?? 1;
  return {
    selfRef: options.selfRef ?? '#/tables/0',
    numRows: grid.length,
    numCols: grid[0]?.length ?? 0,
    cells: grid.flatMap((row, r) =>
      row.map((text, c) => cell(text, r, c, r < headerRows)),
    ),
    ...(options.caption !== undefined ? { caption: options.caption } : {}),
    ...(options.page !== undefined ? { page: options.page } : {}),
  };
};

/** The markdown Docling would have written for that grid, padding included. */
const asMarkdown = (grid: string[][], headerRows = 1) => {
  const line = (cells: string[]) => `| ${cells.join('   | ')}   |`;
  const out = grid.slice(0, headerRows).map(line);
  out.push(`|${grid[0].map(() => '------').join('|')}|`);
  out.push(...grid.slice(headerRows).map(line));
  return out.join('\n');
};

const LIMITS = [
  ['Kod', 'Nazwa', 'Limit'],
  ['CD-1104', 'Szlifierka', '1 204,80'],
  ['CD-1127', 'Wiertarka', '1 338,60'],
];

const document = (tableMarkdown: string) =>
  [
    '# Regulamin',
    '',
    '## Limity',
    '',
    'Poniższa tabela określa limity.',
    '',
    tableMarkdown,
    '',
    'Wnioski rozpatruje Dział Zaopatrzenia.',
  ].join('\n');

describe('exciseTables', () => {
  it('replaces the table with a placeholder and leaves the prose alone', () => {
    const markdown = document(asMarkdown(LIMITS));

    const result = exciseTables(markdown, [table(LIMITS)]);

    expect(result.applied).toBe(true);
    expect(result.markdown).toBe(document('[Table 1]'));
    // The prose keeps a referent; the figures now live in exactly one chunk.
    expect(result.markdown).toContain('Poniższa tabela określa limity.');
    expect(result.markdown).not.toContain('1 204,80');
  });

  it('uses the caption when Docling found one', () => {
    const markdown = document(asMarkdown(LIMITS));

    const result = exciseTables(markdown, [
      table(LIMITS, { caption: 'Limity kwotowe' }),
    ]);

    expect(result.markdown).toContain('[Table 1: Limity kwotowe]');
  });

  it('records the heading stack above each table', () => {
    // `section_path`, computed while the original markdown is still intact.
    const markdown = document(asMarkdown(LIMITS));

    const result = exciseTables(markdown, [table(LIMITS)]);

    expect(result.sectionPaths).toEqual(['Regulamin > Limity']);
  });

  it('matches a run whose cells are padded and aligned', () => {
    // Docling's markdown serialiser pads cells and right-aligns numeric
    // columns. Comparing verbatim would refuse every valid pairing — pinned by
    // the parser contract test.
    const padded = [
      '| Kod       | Nazwa       |    Limit |',
      '|-----------|-------------|----------|',
      '| CD-1104   | Szlifierka  | 1 204,80 |',
      '| CD-1127   | Wiertarka   | 1 338,60 |',
    ].join('\n');

    expect(exciseTables(document(padded), [table(LIMITS)]).applied).toBe(true);
  });

  it('excises several tables and numbers them in order', () => {
    const second = [
      ['Kod', 'Nazwa', 'Stawka'],
      ['SR-201', 'Toczenie', '184,50'],
    ];
    const markdown = [
      '## Limity',
      asMarkdown(LIMITS),
      '',
      '## Stawki',
      asMarkdown(second),
    ].join('\n');

    const result = exciseTables(markdown, [table(LIMITS), table(second)]);

    expect(result.applied).toBe(true);
    expect(result.markdown).toContain('[Table 1]');
    expect(result.markdown).toContain('[Table 2]');
    expect(result.sectionPaths).toEqual(['Limity', 'Stawki']);
  });

  describe('and when it refuses', () => {
    it('refuses wholesale on a count mismatch', () => {
      // One table serialised as an HTML <table> instead of pipes, which is the
      // expected cause.
      const markdown = document(asMarkdown(LIMITS));

      const result = exciseTables(markdown, [table(LIMITS), table(LIMITS)]);

      expect(result.applied).toBe(false);
      expect(result.refusal).toBe('count-mismatch');
      expect(result.markdown).toBe(markdown);
    });

    it('refuses an equal-count near miss on content, not on arithmetic', () => {
      // **The case the count guard cannot see.** One table went out as HTML,
      // and a fenced code block containing a markdown table put a pipe run
      // back. Two tables, two runs — and the pairing is wrong, so excising
      // would delete the code block and file it under the first table.
      const codeBlock = [
        '```markdown',
        '| a | b |',
        '| --- | --- |',
        '| 1 | 2 |',
        '```',
      ].join('\n');
      const markdown = [
        '## Limity',
        asMarkdown(LIMITS),
        '',
        '## Przykład',
        codeBlock,
      ].join('\n');

      const result = exciseTables(markdown, [
        table(LIMITS),
        table([
          ['Kwartał', 'Przychód'],
          ['Q1', '1200000'],
        ]),
      ]);

      expect(result.applied).toBe(false);
      expect(result.refusal).toBe('content-mismatch');
      // Nothing was removed, which is the whole point.
      expect(result.markdown).toBe(markdown);
      expect(result.markdown).toContain('```markdown');
    });

    it('refuses when a run has the right shape but the wrong text', () => {
      const wrong = [
        ['Kod', 'Nazwa', 'Limit'],
        ['CD-9999', 'Nie ta pozycja', '1,00'],
        ['CD-8888', 'Ani ta', '2,00'],
      ];

      const result = exciseTables(document(asMarkdown(wrong)), [table(LIMITS)]);

      expect(result.applied).toBe(false);
      expect(result.refusal).toBe('content-mismatch');
    });

    it('counts a pipe-prefixed prose line as a candidate and refuses', () => {
      // A line that happens to start with a pipe is indistinguishable from a
      // table row to the scanner, which is exactly why the content check is
      // not optional.
      const markdown = [
        '## Limity',
        asMarkdown(LIMITS),
        '',
        '| to nie jest tabela, tylko zdanie zaczynające się od kreski',
      ].join('\n');

      const result = exciseTables(markdown, [table(LIMITS)]);

      expect(result.applied).toBe(false);
      expect(result.refusal).toBe('count-mismatch');
      expect(result.candidateCount).toBe(2);
    });

    it('leaves an indented table alone rather than guessing', () => {
      // Inside a list or a blockquote. A miss, not a corruption — and a
      // scanner loose enough to catch this is loose enough to catch a quoted
      // table.
      const indented = asMarkdown(LIMITS)
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n');

      const result = exciseTables(document(indented), [table(LIMITS)]);

      expect(result.candidateCount).toBe(0);
      expect(result.applied).toBe(false);
      expect(result.markdown).toContain('1 204,80');
    });

    it('leaves a document with no tables byte-for-byte unchanged', () => {
      const markdown = '# Tytuł\n\nAkapit bez tabeli.\n';

      const result = exciseTables(markdown, []);

      expect(result.applied).toBe(false);
      expect(result.refusal).toBe('no-tables');
      expect(result.markdown).toBe(markdown);
    });

    it('keeps a caption that sits outside the run', () => {
      // Captions live in `texts`, not `tables[]`, and Docling renders them
      // adjacent. A caption swallowed by the excision would drop an anchor and
      // shift `source_page`.
      const markdown = [
        '## Limity',
        '',
        'Tabela 1. Limity kwotowe w cyklu trzyletnim.',
        asMarkdown(LIMITS),
      ].join('\n');

      const result = exciseTables(markdown, [table(LIMITS)]);

      expect(result.applied).toBe(true);
      expect(result.markdown).toContain(
        'Tabela 1. Limity kwotowe w cyklu trzyletnim.',
      );
    });
  });
});

describe('buildTableChunks', () => {
  const wide = [
    ['Kod', 'Nazwa', 'Limit'],
    ...Array.from({ length: 40 }, (_, i) => [
      `CD-${1104 + i * 23}`,
      `Pozycja ${i}`,
      `${1000 + i},50`,
    ]),
  ];

  it('repeats the header in every chunk, which is the whole point', () => {
    const chunks = buildTableChunks(table(wide), 0, { budget: 300 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.pageContent).toContain('| Kod | Nazwa | Limit |');
    }
  });

  it('renders markdown pipes rather than CSV', () => {
    // The surrounding chunks are markdown, Docling's own serialiser emits
    // pipes, and a reader following a citation sees a table rather than a
    // comma soup.
    const [chunk] = buildTableChunks(table(LIMITS), 0, { budget: 10_000 });

    expect(chunk.pageContent).toContain('| CD-1104 | Szlifierka | 1 204,80 |');
    expect(chunk.pageContent).toContain('| --- | --- | --- |');
    expect(chunk.pageContent).not.toContain('CD-1104,Szlifierka');
  });

  it('leads with the same placeholder the prose was left', () => {
    const [chunk] = buildTableChunks(table(LIMITS), 2, { budget: 10_000 });

    expect(chunk.pageContent.startsWith('[Table 3]\n')).toBe(true);
    expect(tablePlaceholder(table(LIMITS), 2)).toBe('[Table 3]');
  });

  it('marks the chunk as a table', () => {
    const [chunk] = buildTableChunks(table(LIMITS), 0, { budget: 10_000 });

    expect(chunk.metadata.chunk_type).toBe('table');
  });

  it('carries the page the parser gave the table', () => {
    // Without this the table chunk silently loses the page the markdown chunk
    // it used to live in would have got from `attachSourcePages` — removing
    // "· page {n}" from exactly the content this work exists to make findable.
    const [chunk] = buildTableChunks(table(LIMITS, { page: 7 }), 0, {
      budget: 10_000,
    });

    expect(chunk.metadata.sourcePage).toBe(7);
  });

  it('leaves the page off a table that has none', () => {
    // Confirmed for markdown sources: `prov: []`. Absent, never defaulted.
    const [chunk] = buildTableChunks(table(LIMITS), 0, { budget: 10_000 });

    expect('sourcePage' in chunk.metadata).toBe(false);
  });

  it('carries the section path it was given', () => {
    const [chunk] = buildTableChunks(table(LIMITS), 0, {
      budget: 10_000,
      sectionPath: 'Regulamin > Limity',
    });

    expect(chunk.metadata.sectionPath).toBe('Regulamin > Limity');
  });

  it('repeats nothing when the parser flagged no header', () => {
    // Repeating an arbitrary first row is worse than repeating nothing,
    // because it reads as authoritative.
    const chunks = buildTableChunks(table(wide, { headerRows: 0 }), 0, {
      budget: 300,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1].pageContent).not.toContain('| Kod | Nazwa | Limit |');
    expect(chunks[0].pageContent).not.toContain('| --- |');
  });

  it('repeats a two-level header, flattened', () => {
    // Merged cells lose some column meaning here. Better than no header,
    // worse than the original.
    const twoLevel = [
      ['Pozycja', 'Kwoty', 'Kwoty'],
      ['Kod', 'Katalogowa', 'Limit'],
      ...Array.from({ length: 20 }, (_, i) => [
        `CD-${i}`,
        `${2000 + i},00`,
        `${1000 + i},00`,
      ]),
    ];

    const chunks = buildTableChunks(table(twoLevel, { headerRows: 2 }), 0, {
      budget: 250,
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.pageContent).toContain('| Pozycja | Kwoty | Kwoty |');
      expect(chunk.pageContent).toContain('| Kod | Katalogowa | Limit |');
    }
  });

  it('emits a row wider than the budget whole rather than cutting a field', () => {
    const long = 'x'.repeat(400);
    const grid = [
      ['Kod', 'Opis'],
      ['CD-1', long],
    ];

    const chunks = buildTableChunks(table(grid), 0, { budget: 80 });

    expect(chunks.map((chunk) => chunk.pageContent).join('\n')).toContain(long);
  });

  it('keeps every body row exactly once', () => {
    const chunks = buildTableChunks(table(wide), 0, { budget: 300 });
    const emitted = chunks
      .flatMap((chunk) => chunk.pageContent.split('\n'))
      .filter((line) => line.startsWith('| CD-'));

    expect(emitted).toHaveLength(40);
    expect(new Set(emitted).size).toBe(40);
  });
});
