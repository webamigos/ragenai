import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { loadCorpus } from '../lib/corpus';
import { containsExpectation } from '../lib/grade';

/**
 * The corpora that ship here load, and say what they claim to say.
 *
 * `validateCorpus` has its own unit test against a synthetic corpus; this runs
 * the real ones through it, which is the part that catches a typo in a
 * `questions.json` nobody notices until a benchmark run has already cost forty
 * LLM calls.
 *
 * `tabele-bilingual-v1` gets a second set of assertions, because it exists to
 * expose one specific failure — a table cut at an arbitrary byte, leaving rows
 * of numbers with no column names — and a corpus whose tables fit in one chunk
 * would test nothing while looking identical.
 */
const CORPORA = join(import.meta.dirname, '..', 'corpora');

describe.each(['kolej-bilingual-v1', 'tabele-bilingual-v1'])('%s', (name) => {
  const loaded = loadCorpus(join(CORPORA, name));

  it('loads and validates', () => {
    expect(loaded.corpus.name).toBe(name);
    expect(loaded.questions.length).toBeGreaterThan(0);
  });

  it('ships every document it declares', () => {
    for (const doc of loaded.corpus.documents) {
      const path = join(CORPORA, name, doc.file);
      expect(existsSync(path), `${doc.file} is missing`).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(0);
    }
  });

  it('asks in both directions rather than in one', () => {
    const asked = new Set(loaded.questions.map((q) => q.lang));
    const answered = new Set(loaded.questions.map((q) => q.docLang));
    expect([...asked].sort()).toEqual(['en', 'pl']);
    expect([...answered].sort()).toEqual(['en', 'pl']);
  });

  it('has at least one cross-lingual case and both guards', () => {
    const types = new Set(loaded.questions.map((q) => q.type));
    expect(types.has('cross-lingual')).toBe(true);
    expect(types.has('guard-hallucination')).toBe(true);
    expect(types.has('guard-sycophancy')).toBe(true);
  });
});

/**
 * How many characters the markdown splitter is given for a chunk. The value
 * that matters is `CHUNK_SETTINGS[MARKDOWN].chunkSize` in the worker; it is
 * repeated rather than imported because the eval harness does not depend on
 * the worker, and a drift here would only make this test stricter.
 */
const CHUNK_BUDGET = 800;

describe('tabele-bilingual-v1 can see the failure it was built for', () => {
  const dir = join(CORPORA, 'tabele-bilingual-v1');
  const loaded = loadCorpus(dir);

  const markdownDocs = loaded.corpus.documents.filter((doc) =>
    doc.file.endsWith('.md'),
  );

  it('has a table in every markdown document, longer than one chunk', () => {
    // The premise of the whole corpus. A table that fits in a chunk keeps its
    // header, and the question it is asked would pass either way.
    expect(markdownDocs.length).toBeGreaterThan(1);
    for (const doc of markdownDocs) {
      const text = readFileSync(join(dir, doc.file), 'utf8');
      const tableLines = text
        .split('\n')
        .filter((line) => line.trimStart().startsWith('|'));
      expect(
        tableLines.length,
        `${doc.file} has no pipe table`,
      ).toBeGreaterThan(5);
      expect(
        tableLines.join('\n').length,
        `${doc.file}'s table fits in one chunk, so nothing is lost by splitting it`,
      ).toBeGreaterThan(CHUNK_BUDGET);
    }
  });

  it('includes a spreadsheet, which the flag changes completely', () => {
    // Docling routes CSV and XLSX past the ADR-17 row-group splitter, so a
    // spreadsheet is the file type where table chunking changes everything
    // rather than something. Measured here rather than discovered later.
    const sheets = loaded.corpus.documents.filter((doc) =>
      doc.mimeType.includes('spreadsheet'),
    );
    expect(sheets).toHaveLength(1);
  });

  it('draws every distractor from a real figure in a sibling column', () => {
    // An `expectNone` invented for the occasion proves nothing. Each one here
    // is the value a chunk with no column names actually offers up — the
    // adjacent cell of the same row — so a right-shaped answer from the wrong
    // column fails instead of passing.
    const corpusText = markdownDocs
      .map((doc) => readFileSync(join(dir, doc.file), 'utf8'))
      .concat(
        // The spreadsheet's figures are asserted through the questions that
        // cite them; its bytes are not readable as text here.
        [],
      )
      .join('\n');

    const distractors = loaded.questions.flatMap((q) => q.expectNone ?? []);
    // Fewer than there are questions, on purpose. A rate question's sibling
    // column is the *other* rate, and a correct answer often quotes both —
    // "the standard rate is X, out of hours it is Y" is right, not wrong — so
    // those questions leave the wrong-column check to the rubric. The cap
    // questions keep theirs: the schedule says outright that a list price is
    // never the basis of a settlement.
    expect(distractors.length).toBeGreaterThan(6);

    // Figures that live only in the spreadsheet, whose bytes are not readable
    // as text here. They are checked instead by `build-corpus.mjs`, which
    // refuses to cite any figure whose digits also occur elsewhere in the same
    // document.
    const spreadsheetOnly = new Set(['1568', '64,77']);
    for (const distractor of distractors) {
      if (spreadsheetOnly.has(distractor)) {
        continue;
      }
      expect(
        containsExpectation(corpusText, distractor),
        `"${distractor}" is not a figure in any document, so it cannot be the wrong-column answer`,
      ).toBe(true);
    }
  });

  it('never expects and forbids the same figure', () => {
    // A question whose `expectNone` contains its own answer can never pass,
    // and the report would read as a retrieval failure.
    for (const q of loaded.questions) {
      for (const wanted of q.expectAll ?? []) {
        for (const forbidden of q.expectNone ?? []) {
          expect(
            containsExpectation(wanted, forbidden),
            `${q.id} forbids "${forbidden}", which its own expected answer "${wanted}" contains`,
          ).toBe(false);
        }
      }
    }
  });

  it('says why each question is here, where the reason is not obvious', () => {
    // Not graded and not reported — it is what stops the corpus reading as a
    // pile of arbitrary numbers to whoever inherits it.
    expect(loaded.questions.filter((q) => q.why).length).toBeGreaterThan(3);
  });
});
