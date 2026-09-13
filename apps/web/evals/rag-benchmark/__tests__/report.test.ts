import { describe, it, expect } from 'vitest';
import {
  tally,
  rate,
  formatTally,
  groupBy,
  crosstab,
  isUngraded,
  renderMarkdown,
  resultStem,
} from '../lib/report';
import type { CaseResult, Report } from '../lib/types';

const result = (overrides: Partial<CaseResult>): CaseResult => ({
  questionId: 'q',
  arm: 'rag',
  lang: 'pl',
  docLang: 'pl',
  type: 'numeric',
  question: 'q?',
  answer: 'a',
  assertionsPassed: true,
  assertionFailures: [],
  rubricPassed: true,
  passed: true,
  answerMs: 1,
  durationMs: 1,
  ...overrides,
});

describe('isUngraded', () => {
  it('is false for a case that was measured, pass or fail', () => {
    expect(isUngraded(result({}))).toBe(false);
    expect(isUngraded(result({ passed: false }))).toBe(false);
  });

  it('is true when the call never returned', () => {
    expect(isUngraded(result({ error: 'fetch failed' }))).toBe(true);
  });

  it('is true when the judge verdict could not be read', () => {
    expect(
      isUngraded(
        result({ rubricPassed: null, rubricError: 'judge returned no JSON' }),
      ),
    ).toBe(true);
  });

  // The deterministic gate had already settled it: the figure is missing, or a
  // distractor from another document is present. No verdict the judge might
  // have returned would make that answer right, so dropping the case would
  // inflate the published rate rather than protect it.
  it('is false when the assertions already failed, judge error or not', () => {
    expect(
      isUngraded(
        result({
          assertionsPassed: false,
          assertionFailures: ['missing: "62"'],
          passed: false,
          rubricPassed: null,
          rubricError: 'judge returned no JSON',
        }),
      ),
    ).toBe(false);
  });

  // But a call that never returned has no answer to assert against at all.
  it('is true on a transport error even though no assertion passed', () => {
    expect(
      isUngraded(
        result({
          assertionsPassed: false,
          passed: false,
          error: 'fetch failed',
        }),
      ),
    ).toBe(true);
  });
});

describe('tally / rate / formatTally', () => {
  it('counts passes out of the total', () => {
    expect(tally([result({}), result({ passed: false })])).toEqual({
      passed: 1,
      total: 2,
      ungraded: 0,
    });
  });

  // The whole point of the split: a dropped socket or an unreadable judge
  // verdict must not move the published rate. Both leave the denominator.
  it('keeps ungraded cases out of the denominator', () => {
    expect(
      tally([
        result({}),
        result({ passed: false }),
        result({ passed: false, error: 'fetch failed' }),
        result({ passed: true, rubricPassed: null, rubricError: 'no JSON' }),
      ]),
    ).toEqual({ passed: 1, total: 2, ungraded: 2 });
  });

  it('counts a judge error as a failure when the assertions already failed', () => {
    expect(
      tally([
        result({}),
        result({
          assertionsPassed: false,
          passed: false,
          rubricPassed: null,
          rubricError: 'no JSON',
        }),
      ]),
    ).toEqual({ passed: 1, total: 2, ungraded: 0 });
  });

  it('reports a zero rate for an empty slice rather than dividing by zero', () => {
    expect(rate({ passed: 0, total: 0, ungraded: 0 })).toBe(0);
  });

  it('renders an empty slice as a dash, not as 0%', () => {
    expect(formatTally({ passed: 0, total: 0, ungraded: 0 })).toBe('—');
  });

  it('renders a populated slice with its percentage', () => {
    expect(formatTally({ passed: 3, total: 4, ungraded: 0 })).toBe('3/4 (75%)');
  });

  // A cell that says 0/24 claims 24 measurements. It has to say how many it
  // actually made.
  it('says how many cases went ungraded', () => {
    expect(formatTally({ passed: 0, total: 23, ungraded: 1 })).toBe(
      '0/23 (0%) +1 ungraded',
    );
    expect(formatTally({ passed: 0, total: 0, ungraded: 2 })).toBe(
      '— +2 ungraded',
    );
  });
});

describe('groupBy', () => {
  it('preserves first-seen key order', () => {
    const grouped = groupBy(['bb', 'a', 'cc', 'd'], (s) => String(s.length));
    expect([...grouped.keys()]).toEqual(['2', '1']);
    expect(grouped.get('2')).toEqual(['bb', 'cc']);
  });
});

describe('crosstab', () => {
  it('splits a slice across both arms', () => {
    const rows = crosstab(
      [
        result({ lang: 'pl', arm: 'rag', passed: true }),
        result({ lang: 'pl', arm: 'no-rag', passed: false }),
        result({ lang: 'en', arm: 'rag', passed: false }),
      ],
      (r) => r.lang,
    );
    expect(rows).toEqual([
      {
        key: 'pl',
        byArm: {
          rag: { passed: 1, total: 1, ungraded: 0 },
          'no-rag': { passed: 0, total: 1, ungraded: 0 },
        },
      },
      {
        key: 'en',
        byArm: {
          rag: { passed: 0, total: 1, ungraded: 0 },
          'no-rag': { passed: 0, total: 0, ungraded: 0 },
        },
      },
    ]);
  });
});

describe('renderMarkdown', () => {
  const report: Report = {
    corpus: 'test-corpus',
    corpusVersion: 1,
    fingerprint: {
      date: '2026-09-12',
      gitSha: 'abc1234',
      chatModel: 'gemini-3-flash-preview',
      judgeModel: 'gemini-2.5-flash',
      rephraseModel: 'mistral-small-3.2',
      embeddingsModel: 'bge-multilingual-gemma2',
      vectorSize: '3584',
      rerankProvider: 'scaleway',
      rerankModel: 'qwen3-embedding-8b',
      rerankingEnabled: 'on',
      multiQueryVariants: '1',
      appUrl: 'http://localhost:3000',
    },
    results: [
      result({ questionId: 'pl-1', lang: 'pl', docLang: 'pl' }),
      result({
        questionId: 'xl-1',
        lang: 'pl',
        docLang: 'en',
        passed: false,
        assertionFailures: ['missing: "62"'],
      }),
      result({ questionId: 'pl-1', arm: 'no-rag', passed: false }),
    ],
  };

  it('records the stack the numbers came from', () => {
    const md = renderMarkdown(report);
    expect(md).toContain('bge-multilingual-gemma2');
    expect(md).toContain('abc1234');
    expect(md).toContain('2026-09-12');
  });

  it('separates same-language from cross-lingual', () => {
    expect(renderMarkdown(report)).toContain('cross-lingual');
  });

  it('lists only the RAG arm in the per-case table', () => {
    const md = renderMarkdown(report);
    const detail = md.slice(md.indexOf('Per-case detail'));
    expect(detail).toContain('`pl-1`');
    expect(detail).toContain('`xl-1`');
    expect(detail).toContain('missing: "62"');
  });

  // The per-case table covers the RAG arm only, so without its own section a
  // control-arm error leaves no trace in the rendered report beyond a smaller
  // denominator — which is how "0/24 refusals" got published for 23.
  it('lists an ungraded case from either arm in its own section', () => {
    const md = renderMarkdown({
      ...report,
      results: [
        result({ questionId: 'pl-1' }),
        result({
          questionId: 'en-guard',
          arm: 'no-rag',
          passed: false,
          error: 'fetch failed',
        }),
        result({
          questionId: 'pl-rubric',
          rubricPassed: null,
          rubricError: 'judge returned no JSON',
        }),
      ],
    });
    const section = md.slice(md.indexOf('## Ungraded cases'));
    expect(section).toContain('`en-guard` | no-rag | fetch failed');
    expect(section).toContain('`pl-rubric` | rag | judge returned no JSON');
    expect(section).not.toContain('`pl-1`');
    // And the RAG arm's table calls the judge failure out rather than
    // presenting it as a pass.
    const detail = md.slice(
      md.indexOf('Per-case detail'),
      md.indexOf('## Ungraded'),
    );
    expect(detail).toContain('UNGRADED');
    expect(detail).toContain('judge: judge returned no JSON');
  });

  it('reports both the assertion failure and the silent judge in one note', () => {
    const md = renderMarkdown({
      ...report,
      results: [
        result({
          questionId: 'pl-both',
          assertionsPassed: false,
          assertionFailures: ['missing: "62"'],
          passed: false,
          rubricPassed: null,
          rubricError: 'judge returned no JSON',
        }),
      ],
    });
    const detail = md.slice(md.indexOf('Per-case detail'));
    expect(detail).toContain('missing: "62"; judge: judge returned no JSON');
    expect(detail).toContain('FAIL');
    expect(md).not.toContain('## Ungraded cases');
  });

  it('omits the ungraded section when every case was measured', () => {
    expect(renderMarkdown(report)).not.toContain('## Ungraded cases');
  });

  // A pipe inside a failure note would otherwise split the table cell.
  it('escapes a pipe in a failure note', () => {
    const md = renderMarkdown({
      ...report,
      results: [
        result({ passed: false, assertionFailures: ['none of: a | b'] }),
      ],
    });
    expect(md).toContain('none of: a \\| b');
  });
});

/**
 * Repeated runs of one corpus revision do not destroy each other.
 *
 * The README tells you to record the median of at least three runs, and until
 * `resultStem` existed the second run wrote the first one's file name: same
 * date, same revision. A benchmark that deletes its own evidence while asking
 * for more of it is worse than one that never asked.
 */
describe('resultStem', () => {
  const none = () => false;

  it('names the first run by date and corpus revision', () => {
    expect(resultStem('2026-09-12', 'tabele-bilingual-v1', 1, none)).toBe(
      '2026-09-12-tabele-bilingual-v1-rev1',
    );
  });

  it('leaves an existing result alone and puts the next run beside it', () => {
    const taken = new Set(['2026-09-12-tabele-bilingual-v1-rev1']);
    expect(
      resultStem('2026-09-12', 'tabele-bilingual-v1', 1, (s) => taken.has(s)),
    ).toBe('2026-09-12-tabele-bilingual-v1-rev1-run2');
  });

  it('keeps counting past the second run', () => {
    const taken = new Set([
      '2026-09-12-tabele-bilingual-v1-rev1',
      '2026-09-12-tabele-bilingual-v1-rev1-run2',
      '2026-09-12-tabele-bilingual-v1-rev1-run3',
    ]);
    expect(
      resultStem('2026-09-12', 'tabele-bilingual-v1', 1, (s) => taken.has(s)),
    ).toBe('2026-09-12-tabele-bilingual-v1-rev1-run4');
  });

  it('keeps a corrected corpus separate from the revision before it', () => {
    // A rubric change measures a different instrument; the two numbers are not
    // comparable and must not share a file.
    const taken = new Set(['2026-09-12-tabele-bilingual-v1-rev1']);
    expect(
      resultStem('2026-09-12', 'tabele-bilingual-v1', 2, (s) => taken.has(s)),
    ).toBe('2026-09-12-tabele-bilingual-v1-rev2');
  });

  it('keeps two corpora of the same day apart', () => {
    const taken = new Set(['2026-09-12-tabele-bilingual-v1-rev1']);
    expect(
      resultStem('2026-09-12', 'kolej-bilingual-v1', 1, (s) => taken.has(s)),
    ).toBe('2026-09-12-kolej-bilingual-v1-rev1');
  });
});
