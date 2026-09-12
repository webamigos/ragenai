import type { Arm, CaseResult, Report } from './types';

export interface Tally {
  passed: number;
  /** Graded cases only — `ungraded` is excluded, not counted as a loss. */
  total: number;
  ungraded: number;
}

/**
 * A case the instrument failed to measure, as opposed to one the pipeline
 * failed: the call never returned (`error`), or the judge's verdict on a
 * declared rubric could not be read (`rubricError`).
 *
 * Counting these as failures publishes a number that moves when a socket drops
 * or the judge model has a bad minute — which is the one thing a benchmark
 * must not do. They are excluded from every denominator and reported on their
 * own, so a run with many of them reads as a run that did not measure much
 * rather than as a regression.
 *
 * An unreadable judge verdict only leaves the case unmeasured when the
 * deterministic gate had not already settled it. If the substring assertions
 * failed, the answer is wrong whatever the judge would have said — the figure
 * is missing, or a distractor from another document is present — and dropping
 * that case would inflate the published rate rather than protect it.
 */
export function isUngraded(r: CaseResult): boolean {
  if (r.error) {
    return true;
  }
  return Boolean(r.rubricError) && r.assertionsPassed;
}

export function tally(results: CaseResult[]): Tally {
  const graded = results.filter((r) => !isUngraded(r));
  return {
    passed: graded.filter((r) => r.passed).length,
    total: graded.length,
    ungraded: results.length - graded.length,
  };
}

export function rate({ passed, total }: Tally): number {
  return total === 0 ? 0 : passed / total;
}

export function formatTally(t: Tally): string {
  const ungraded = t.ungraded > 0 ? ` +${t.ungraded} ungraded` : '';
  return t.total === 0
    ? `—${ungraded}`
    : `${t.passed}/${t.total} (${Math.round(rate(t) * 100)}%)${ungraded}`;
}

/** Group by an arbitrary key, preserving first-seen order of the keys. */
export function groupBy<T>(
  items: T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) {
      bucket.push(item);
    } else {
      out.set(k, [item]);
    }
  }
  return out;
}

export const ARMS: Arm[] = ['rag', 'no-rag'];

/**
 * A cell of the report: one arm, one slice.
 *
 * The `no-rag` arm is not decoration. Every figure in the corpus is invented,
 * so whatever the control scores is what the same model produces from the
 * question alone — the floor that retrieval has to beat for the pipeline to be
 * earning its cost. A `rag` number published without it says nothing.
 */
export function crosstab(
  results: CaseResult[],
  slice: (r: CaseResult) => string,
): { key: string; byArm: Record<Arm, Tally> }[] {
  const keys = [...new Set(results.map(slice))];
  return keys.map((key) => {
    const rows = results.filter((r) => slice(r) === key);
    const byArm = {} as Record<Arm, Tally>;
    for (const arm of ARMS) {
      byArm[arm] = tally(rows.filter((r) => r.arm === arm));
    }
    return { key, byArm };
  });
}

function table(
  title: string,
  rows: { key: string; byArm: Record<Arm, Tally> }[],
): string {
  const lines = [
    `### ${title}`,
    '',
    '| | Ragen (RAG) | control (no retrieval) |',
    '|---|---|---|',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.key} | ${formatTally(row.byArm.rag)} | ${formatTally(row.byArm['no-rag'])} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function renderMarkdown(report: Report): string {
  const { results, fingerprint } = report;
  const overall = crosstab(results, () => 'all questions');

  const out: string[] = [
    `# RAG benchmark — ${report.corpus} v${report.corpusVersion}`,
    '',
    `Run on **${fingerprint.date}** against commit \`${fingerprint.gitSha}\`.`,
    '',
    'Every figure in this corpus was invented for it and exists nowhere else, so a',
    'correct answer is evidence that retrieval worked rather than that the model',
    'remembered. The control column is the same model answering the same question',
    'with no documents attached — the floor the pipeline has to beat.',
    '',
    '## Stack under test',
    '',
    '| | |',
    '|---|---|',
    `| chat model | \`${fingerprint.chatModel}\` |`,
    `| judge model | \`${fingerprint.judgeModel}\` |`,
    `| rephrase model | \`${fingerprint.rephraseModel}\` |`,
    `| embeddings | \`${fingerprint.embeddingsModel}\` (${fingerprint.vectorSize}-dim) |`,
    `| reranking | ${fingerprint.rerankingEnabled} — \`${fingerprint.rerankProvider}\` / \`${fingerprint.rerankModel}\` |`,
    `| multi-query variants | ${fingerprint.multiQueryVariants} |`,
    '',
    '## Overall',
    '',
    table('All questions', overall),
    '## By language',
    '',
    table(
      'Language the question was asked in',
      crosstab(results, (r) => r.lang),
    ),
    table(
      'Language of the document holding the answer',
      crosstab(results, (r) => r.docLang),
    ),
    table(
      'Same-language vs cross-lingual',
      crosstab(results, (r) =>
        r.lang === r.docLang
          ? 'question and document same language'
          : 'cross-lingual',
      ),
    ),
    '## By question type',
    '',
    table(
      'Question type',
      crosstab(results, (r) => r.type),
    ),
    '## Per-case detail (RAG arm)',
    '',
    '| id | lang → doc | type | result | note |',
    '|---|---|---|---|---|',
  ];

  for (const r of results.filter((x) => x.arm === 'rag')) {
    out.push(
      `| \`${r.questionId}\` | ${r.lang} → ${r.docLang} | ${r.type} | ${caseVerdict(r)} | ${cell(caseNote(r))} |`,
    );
  }
  out.push('');

  // Every ungraded case, both arms. Without this section the control arm's
  // failures-to-measure are invisible in the rendered report — the per-case
  // table above covers the RAG arm only, and an excluded case leaves no trace
  // in a tally beyond a smaller denominator.
  const ungraded = results.filter(isUngraded);
  if (ungraded.length > 0) {
    out.push(
      '## Ungraded cases',
      '',
      'Not measured, so not counted either way. Excluded from every tally above.',
      '',
      '| id | arm | why |',
      '|---|---|---|',
    );
    for (const r of ungraded) {
      out.push(
        `| \`${r.questionId}\` | ${r.arm} | ${cell(r.error ?? r.rubricError ?? '')} |`,
      );
    }

    out.push('');
  }

  return out.join('\n');
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').slice(0, 160);
}

function caseVerdict(r: CaseResult): string {
  if (isUngraded(r)) {
    return 'UNGRADED';
  }
  return r.passed ? 'PASS' : 'FAIL';
}

function caseNote(r: CaseResult): string {
  if (r.error) {
    return `error: ${r.error}`;
  }
  // The judge note is appended rather than substituted: when the assertions
  // also failed, the case is a measured failure *and* the judge did not
  // report, and the row has to say both.
  return [
    ...r.assertionFailures,
    r.rubricPassed === false ? `rubric: ${r.rubricReason ?? ''}` : '',
    r.rubricError ? `judge: ${r.rubricError}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * A file name for one run, which never collides with a run already recorded.
 *
 * The date and the corpus revision are what make a number mean something — a
 * corrected rubric measures a different instrument — but they do not separate
 * *runs*. The README says to record the median of at least three, and until
 * this existed the second run silently overwrote the first: same date, same
 * revision, same name. A benchmark that destroys its own evidence while
 * telling you to collect more of it is worse than one that never asked.
 *
 * `exists` is injected so this is testable without a filesystem.
 */
export function resultStem(
  date: string,
  corpusName: string,
  corpusVersion: number,
  exists: (stem: string) => boolean,
): string {
  const base = `${date}-${corpusName}-rev${corpusVersion}`;
  if (!exists(base)) {
    return base;
  }
  // `-run2` onwards. The first run keeps the bare name so an existing result
  // file does not have to be renamed for this to ship.
  for (let run = 2; run < 1000; run += 1) {
    const candidate = `${base}-run${run}`;
    if (!exists(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Refusing to write a 1000th run of ${base}`);
}
