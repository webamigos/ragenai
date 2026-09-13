/**
 * Multilingual RAG benchmark against a *live* stack.
 *
 * Uploads a corpus through the real ingestion path, asks each question through
 * the real chat endpoint, and asks the same questions of the same model with no
 * documents attached as a control. Writes a dated report to `results/`.
 *
 * Unlike the promptfoo suites next door — which serve a fixed context from an
 * in-memory keyword store and so measure answer quality, never retrieval —
 * every stage here is the production one: rephrase, multi-query expansion,
 * hybrid dense+sparse search, reranking, and the answer prompt.
 *
 * Run it on someone else's documents with `--corpus /path/to/dir`; nothing in
 * this file knows about the corpus that ships with it.
 *
 * See ./README.md for prerequisites.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loadCorpus, resolveCorpusDir } from './lib/corpus';
import { askRag, askControl } from './lib/arms';
import { runAssertions, judge } from './lib/grade';
import { renderMarkdown, resultStem, tally } from './lib/report';
import { withRetry } from './lib/retry';
import { parseArgs, waitForIngest } from './lib/runner';
import type { CaseResult, Report, StackFingerprint } from './lib/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

const APP_URL = process.env.RAG_EVAL_APP_URL ?? 'http://localhost:3000';
const EMAIL = process.env.RAG_EVAL_EMAIL ?? 'e2e-test@ragen.ai';
const PASSWORD = process.env.RAG_EVAL_PASSWORD ?? 'E2eTestPassword123!';
const PROJECT_ID =
  process.env.RAG_EVAL_PROJECT_ID ?? 'e2e00000-0000-0000-0000-00e2e0000001';
const THREAD_ID =
  process.env.RAG_EVAL_THREAD_ID ?? 'e2e00000-0000-0000-0000-00e2e0000010';
const INGEST_TIMEOUT_MS = Number(process.env.RAG_EVAL_TIMEOUT_MS ?? 600_000);

const LITELLM_URL = process.env.LITELLM_PROXY_URL ?? 'http://localhost:4000';
const LITELLM_KEY = process.env.LITELLM_MASTER_KEY;
/** The control arm and the judge must be named explicitly, so the report can. */
const CONTROL_MODEL =
  process.env.RAG_EVAL_CONTROL_MODEL ?? 'gemini-3-flash-preview';
const JUDGE_MODEL = process.env.RAG_EVAL_JUDGE_MODEL ?? 'gemini-2.5-flash';

const DEFAULT_CORPUS_DIR = join(__dirname, 'corpora', 'kolej-bilingual-v1');

async function login(): Promise<string> {
  const res = await fetch(`${APP_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_URL },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Sign-in failed (${res.status}): ${await res.text()}`);
  }
  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie) {
    throw new Error('Sign-in returned no session cookie');
  }
  return cookie;
}

export interface UploadOutcome {
  /** Ids of the files that were actually created. */
  ids: string[];
  /** Human-readable reasons for the files that were not, if any. */
  failures: string[];
}

/**
 * Upload the corpus and report the **ids** the API assigned.
 *
 * The ids, not the file names, are what the rest of the run keys on: the names
 * are shared with every earlier run against the same database, so waiting or
 * deleting by name reaches rows this run never created.
 *
 * A partial upload is reported rather than thrown, because the ids that *did*
 * get created still have to reach the caller: they are what the `finally`
 * block deletes. Throwing here would abort the run with those files and their
 * vectors left in the collection, skewing the next one — the exact leak the
 * cleanup exists to prevent.
 */
async function uploadCorpus(
  cookie: string,
  dir: string,
  documents: { file: string; mimeType: string }[],
): Promise<UploadOutcome> {
  const form = new FormData();
  for (const doc of documents) {
    const bytes = new Uint8Array(readFileSync(join(dir, doc.file)));
    form.append(
      'files',
      new File([bytes], basename(doc.file), { type: doc.mimeType }),
    );
  }
  form.append('projectId', PROJECT_ID);

  const res = await fetch(`${APP_URL}/api/upload`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: APP_URL },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as {
    files?: { fileName: string; uniqueFileId: string }[];
    failedFiles?: { fileName: string; error: string }[];
  };
  const ids = (body.files ?? []).map((f) => f.uniqueFileId);
  const failures = (body.failedFiles ?? []).map(
    (f) => `${f.fileName} (${f.error})`,
  );
  // The route answers 200 as long as one file made it through, so a short list
  // is the only sign that some did not.
  if (failures.length === 0 && ids.length !== documents.length) {
    failures.push(
      `returned ${ids.length} file id(s) for ${documents.length} document(s)`,
    );
  }
  return { ids, failures };
}

/**
 * The thread is reused across runs, so its history has to go before the
 * questions and not only after: a model that can see the previous run's
 * answers will "retrieve" from them, and every case passes for the wrong
 * reason.
 */
async function clearThread(
  prisma: PrismaClient,
  opts: { quiet?: boolean } = {},
): Promise<void> {
  const { count } = await prisma.message.deleteMany({
    where: { threadId: THREAD_ID },
  });
  if (!opts.quiet) {
    console.log(`  cleared ${count} thread messages`);
  }
}

/**
 * Delete through the product's own path rather than with `deleteMany`, because
 * that is what removes the Qdrant points too. Leftover points from a previous
 * run would sit in the collection as duplicates and quietly change the next
 * run's ranking.
 */
async function deleteUploadedFiles(
  prisma: PrismaClient,
  fileIds: string[],
): Promise<void> {
  const secret = process.env.INTERNAL_API_SECRET;
  // By id, so cleanup can only reach the rows this run created. Matching on
  // `fileName` would delete a previous run's leftovers — or a colleague's
  // identically-named document — from the same database.
  const files = await prisma.userFile.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, fileName: true, organizationId: true, ownerId: true },
  });

  if (!secret) {
    console.log(
      `  warning: INTERNAL_API_SECRET is unset, so ${files.length} file(s) were left in place. ` +
        'Their Qdrant points will skew the next run — delete them in the UI, or set the secret.',
    );
    return;
  }

  let deleted = 0;
  for (const file of files) {
    const res = await fetch(`${APP_URL}/api/v1/files/${file.id}`, {
      method: 'DELETE',
      headers: {
        'x-internal-secret': secret,
        'x-org-id': file.organizationId ?? '',
        'x-user-id': file.ownerId ?? '',
        'x-project-id': PROJECT_ID,
        Origin: APP_URL,
      },
    });
    if (res.ok) {
      deleted++;
    } else {
      console.log(
        `  warning: could not delete ${file.fileName} (${res.status})`,
      );
    }
  }
  console.log(
    `  deleted ${deleted}/${files.length} uploaded files (and their vectors)`,
  );
}

function fingerprint(): StackFingerprint {
  let gitSha = 'unknown';
  try {
    gitSha = execSync('git rev-parse --short HEAD', {
      cwd: __dirname,
      encoding: 'utf8',
    }).trim();
  } catch {
    // Running outside a checkout is fine; the report just says "unknown".
  }
  return {
    date: new Date().toISOString().slice(0, 10),
    gitSha,
    chatModel: process.env.DEFAULT_MODEL ?? '(app default)',
    judgeModel: JUDGE_MODEL,
    rephraseModel: process.env.REPHRASE_MODEL ?? '(app default)',
    embeddingsModel: process.env.EMBEDDINGS_MODEL ?? '(app default)',
    vectorSize: process.env.VECTOR_SIZE ?? '(app default)',
    rerankProvider: process.env.RERANK_PROVIDER ?? '(unset)',
    rerankModel: process.env.RERANK_MODEL ?? '(unset)',
    rerankingEnabled: process.env.FEATURE_FLAG_RERANKING === '1' ? 'on' : 'off',
    multiQueryVariants: process.env.MULTI_QUERY_VARIANT_COUNT ?? '1 (default)',
    appUrl: APP_URL,
  };
}

/**
 * PASS / FAIL, or UNGRADED when the judge never delivered a readable verdict
 * *and* the deterministic gate had not already settled the case. Mirrors
 * `isUngraded` in lib/report.ts, which decides the same thing for the tallies.
 */
function caseLabel(
  rubricError: string | undefined,
  assertionsPassed: boolean,
  passed: boolean,
): string {
  if (rubricError && assertionsPassed) {
    return 'UNGRADED';
  }
  return passed ? 'PASS' : 'FAIL';
}

function caseNote(
  rubricError: string | undefined,
  passed: boolean,
  assertionFailures: string[],
  rubricReason: string | undefined,
): string {
  const why = [
    ...assertionFailures,
    passed ? '' : (rubricReason ?? ''),
    rubricError ? `judge: ${rubricError}` : '',
  ]
    .filter(Boolean)
    .join('; ');
  return why ? ` — ${why.slice(0, 160)}` : '';
}

async function main(): Promise<void> {
  const { corpus: corpusArg, arms } = parseArgs(
    process.argv.slice(2),
    DEFAULT_CORPUS_DIR,
  );
  const dir = resolveCorpusDir(corpusArg, process.cwd());
  const { corpus, questions } = loadCorpus(dir);

  console.log(`Corpus: ${corpus.name} v${corpus.version} (${dir})`);
  console.log(
    `  ${corpus.documents.length} documents, ${questions.length} questions`,
  );
  console.log(`  arms: ${arms.join(', ')}\n`);

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const results: CaseResult[] = [];
  /** Ids of the files this run uploaded — what waiting and cleanup key on. */
  let uploaded: string[] = [];
  let cookie: string | undefined;

  try {
    if (arms.includes('rag')) {
      console.log(`[1/4] Signing in as ${EMAIL}`);
      cookie = await login();

      console.log(`[2/4] Uploading ${corpus.documents.length} documents`);
      const upload = await uploadCorpus(cookie, dir, corpus.documents);
      // Assigned before the check, so a partial upload still gets cleaned up:
      // `uploaded` is what the `finally` block deletes.
      uploaded = upload.ids;
      if (upload.failures.length > 0) {
        // A partial upload measures a smaller corpus than the report would
        // claim, so it aborts the run rather than quietly shrinking it.
        throw new Error(
          `Upload rejected ${upload.failures.length} file(s): ${upload.failures.join(', ')}`,
        );
      }

      console.log('[3/4] Waiting for ingestion');
      await waitForIngest(prisma, uploaded, { timeoutMs: INGEST_TIMEOUT_MS });

      console.log('[4/4] Clearing thread history');
      await clearThread(prisma);
    }

    console.log(
      `\nAsking ${questions.length} questions × ${arms.length} arm(s)\n`,
    );
    for (const q of questions) {
      for (const arm of arms) {
        const started = Date.now();
        const base = {
          questionId: q.id,
          arm,
          lang: q.lang,
          docLang: q.docLang,
          type: q.type,
          question: q.question,
        };
        try {
          const onRetry = (attempt: number, err: unknown) =>
            console.log(
              `  retry ${attempt} [${arm}] ${q.id} — ${String(err).slice(0, 120)}`,
            );

          let answer: string;
          let citedFiles: string[] | undefined;
          const answerStarted = Date.now();
          if (arm === 'rag') {
            const ragAnswer = await withRetry(
              async () => {
                // Every *attempt* starts from an empty thread, not just every
                // question. A failed attempt can still have persisted its user
                // message — or a partial answer — and the retry would then run
                // with that history in context, which is the leakage the
                // post-success clear below exists to prevent.
                await clearThread(prisma, { quiet: true });
                return askRag({
                  appUrl: APP_URL,
                  threadId: THREAD_ID,
                  cookie: cookie ?? '',
                  question: q.question,
                });
              },
              { onRetry },
            );
            answer = ragAnswer.text;
            citedFiles = ragAnswer.citedFileIds;
            // Each question is independent: a leftover history would let a
            // later question answer from an earlier answer rather than from
            // the documents.
            await clearThread(prisma, { quiet: true });
          } else {
            answer = await withRetry(
              () =>
                askControl({
                  baseUrl: LITELLM_URL,
                  apiKey: LITELLM_KEY,
                  model: CONTROL_MODEL,
                  question: q.question,
                }),
              { onRetry },
            );
          }

          const answerMs = Date.now() - answerStarted;

          const assertions = runAssertions(q, answer);
          let rubricPassed: boolean | null = null;
          let rubricReason: string | undefined;
          let rubricError: string | undefined;
          if (q.rubric) {
            const verdict = await withRetry(
              () =>
                judge(q.rubric!, q.question, answer, {
                  baseUrl: LITELLM_URL,
                  apiKey: LITELLM_KEY,
                  model: JUDGE_MODEL,
                }),
              { onRetry },
            );
            rubricReason = verdict.reason;
            // An unreadable verdict leaves `rubricPassed` null. Recording
            // `false` would spend a real failure on the judge's formatting and
            // move the published rate; the report excludes the case instead.
            rubricPassed = verdict.error ? null : verdict.pass;
            rubricError = verdict.error;
          }

          const passed = assertions.passed && rubricPassed !== false;
          results.push({
            ...base,
            answer,
            assertionsPassed: assertions.passed,
            assertionFailures: assertions.failures,
            rubricPassed,
            rubricReason,
            rubricError,
            passed,
            citedFiles,
            answerMs,
            durationMs: Date.now() - started,
          });
          console.log(
            `  ${caseLabel(rubricError, assertions.passed, passed)}  [${arm}] ${q.id}` +
              caseNote(rubricError, passed, assertions.failures, rubricReason),
          );
        } catch (err) {
          results.push({
            ...base,
            answer: '',
            assertionsPassed: false,
            assertionFailures: [],
            rubricPassed: null,
            passed: false,
            error: err instanceof Error ? err.message : String(err),
            answerMs: 0,
            durationMs: Date.now() - started,
          });
          console.log(
            `  ERROR [${arm}] ${q.id} — ${String(err).slice(0, 200)}`,
          );
        }
      }
    }
  } finally {
    if (uploaded.length > 0) {
      console.log('\nCleaning up');
      await deleteUploadedFiles(prisma, uploaded).catch((e: unknown) =>
        console.log(`  warning: cleanup failed: ${String(e)}`),
      );
      // Not `.catch(() => undefined)`: a thread left with this run's messages
      // is exactly what makes the *next* run answer from its predecessor's
      // answers instead of from the documents, and every case then passes for
      // the wrong reason. A cleanup that fails has to say so.
      await clearThread(prisma).catch((e: unknown) =>
        console.log(
          `  warning: could not clear the thread (${String(e)}) — clear it before the next run, or its answers will leak into that one`,
        ),
      );
    }
    await prisma.$disconnect();
  }

  const report: Report = {
    corpus: corpus.name,
    corpusVersion: corpus.version,
    fingerprint: fingerprint(),
    results,
  };

  const outDir = join(__dirname, 'results');
  mkdirSync(outDir, { recursive: true });
  // The corpus revision belongs in the file name: correcting a rubric changes
  // what the number means, and two files from the same day that measured
  // different instruments must not overwrite each other. Repeated runs of the
  // same revision get a `-runN` suffix — the README asks for the median of at
  // least three, and before this the second run overwrote the first.
  const stem = resultStem(
    report.fingerprint.date,
    corpus.name,
    corpus.version,
    (candidate) => existsSync(join(outDir, `${candidate}.json`)),
  );
  writeFileSync(join(outDir, `${stem}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, `${stem}.md`), renderMarkdown(report));
  console.log(`\nWrote results/${stem}.json and results/${stem}.md`);

  const rag = tally(results.filter((r) => r.arm === 'rag'));
  console.log(
    `\nRAG arm: ${rag.passed}/${rag.total} passed` +
      (rag.total ? ` (${Math.round((rag.passed / rag.total) * 100)}%)` : '') +
      (rag.ungraded ? `, ${rag.ungraded} ungraded` : ''),
  );
}

main().catch((e: unknown) => {
  console.error('\nERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
