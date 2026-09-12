/**
 * With the flag off, ingest output is byte-identical to before this work.
 *
 * Phase B is dead code until `FEATURE_FLAG_TABLE_CHUNKS=1` is set, and that is
 * what makes it safe to land ahead of the Phase C decision. "Dead code" is a
 * claim about behaviour, so it is tested rather than asserted — and tested on
 * the two file types the flag changes **by side effect**, not only on a PDF:
 * `DOCLING_SUPPORTED_TYPES` covers CSV and XLSX, and `split-documents.ts`
 * returns to the markdown splitter before the `FileType` switch that would
 * route them to the row-group splitter.
 *
 * `TABLE_CHUNKS_ENABLED` is read at module load, so each half of this runs in
 * its own `jest.isolateModules` block with the environment set first.
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('bytes')),
}));
jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import type { DoclingConversion } from '../docling-client';

const load = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8')) as {
    document: Record<string, unknown>;
  };

const MARKDOWN_TABLE = load('docling-markdown-table.json');
const SPREADSHEET = load('docling-spreadsheet.json');

const respond = (document: Record<string, unknown>) => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ status: 'success', document, errors: [] }),
  });
};

/** Re-imports the client with the flag in whatever state the caller set. */
async function convertWith(
  flag: string | undefined,
  document: Record<string, unknown>,
): Promise<DoclingConversion> {
  const previous = process.env.FEATURE_FLAG_TABLE_CHUNKS;
  if (flag === undefined) {
    delete process.env.FEATURE_FLAG_TABLE_CHUNKS;
  } else {
    process.env.FEATURE_FLAG_TABLE_CHUNKS = flag;
  }
  respond(document);
  try {
    let result!: Promise<DoclingConversion>;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../docling-client') as {
        convertWithDocling: (
          path: string,
          name: string,
        ) => Promise<DoclingConversion>;
      };
      result = mod.convertWithDocling('/tmp/f', 'f');
    });
    return await result;
  } finally {
    if (previous === undefined) {
      delete process.env.FEATURE_FLAG_TABLE_CHUNKS;
    } else {
      process.env.FEATURE_FLAG_TABLE_CHUNKS = previous;
    }
  }
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe.each([
  ['a markdown document with a table', MARKDOWN_TABLE],
  ['a spreadsheet', SPREADSHEET],
])('with the flag off — %s', (_name, fixture) => {
  it('returns the markdown exactly as Docling wrote it', async () => {
    const conversion = await convertWith(undefined, fixture.document);

    expect(conversion.markdown).toBe(fixture.document.md_content);
    expect(conversion.markdown).toContain('|');
  });

  it('does not excise, and says so rather than claiming it tried', async () => {
    const conversion = await convertWith(undefined, fixture.document);

    expect(conversion.tableExcision.applied).toBe(false);
    expect(conversion.tableExcision.candidateCount).toBe(0);
  });

  it('is unchanged by the flag being explicitly off rather than absent', async () => {
    const off = await convertWith('0', fixture.document);
    const absent = await convertWith(undefined, fixture.document);

    expect(off.markdown).toBe(absent.markdown);
    expect(off.tableExcision.applied).toBe(false);
  });

  it('still carries the parsed tables, which nothing reads', async () => {
    // The transport landed in its own step and is not conditional on the flag.
    // What the flag gates is whether they leave the markdown and become
    // chunks — `loadDocling` withholds the metadata key unless the excision
    // applied.
    const conversion = await convertWith(undefined, fixture.document);

    expect(conversion.tables.length).toBeGreaterThan(0);
  });
});

describe.each([
  ['a markdown document with a table', MARKDOWN_TABLE],
  ['a spreadsheet', SPREADSHEET],
])('with the flag on — %s', (_name, fixture) => {
  it('takes the table out and leaves a placeholder', async () => {
    const conversion = await convertWith('1', fixture.document);

    expect(conversion.tableExcision.applied).toBe(true);
    expect(conversion.markdown).toContain('[Table 1]');
    expect(conversion.markdown.split('\n').some((l) => l.startsWith('|'))).toBe(
      false,
    );
  });

  it('anchors the post-excision markdown, not the original', async () => {
    // The reason excision lives inside `convertWithDocling` and not beside
    // the splitter: anchoring the pre-excision string and cutting the
    // post-excision one would misattribute the page of every element after
    // the first table, and nothing in the repo would catch it.
    const conversion = await convertWith('1', fixture.document);

    for (const anchor of conversion.pageAnchors) {
      expect(anchor.offset).toBeLessThan(conversion.markdown.length);
    }
  });
});
