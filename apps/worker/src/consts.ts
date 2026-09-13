import { resolveEmbeddingsModel } from '@ragenai/rag-core';

export const targetEnv = process.env.TARGET_ENV!;

export const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || 'local';
// export const TEMPORAL_SERVER_ADDRESS =
//   `${TEMPORAL_NAMESPACE}.${process.env.TEMPORAL_SERVER_ADDRESS}` ||
//   'localhost:7233';
export const TEMPORAL_SERVER_ADDRESS =
  `${process.env.TEMPORAL_SERVER_ADDRESS}` || 'localhost:7233';

/**
 * Embedding model used for both ingest and query.
 *
 * Resolved through @ragenai/rag-core so the worker, the app and the API cannot
 * disagree: the fallback and the matching VECTOR_SIZE live together there.
 * They used to disagree — this defaulted to cohere-embed-multilingual-v3
 * (1024 dims) against a 3584-dim collection, so an install that set neither
 * variable had every Qdrant upsert rejected. See ADR-26.
 */
export const EMBEDDINGS_MODEL = resolveEmbeddingsModel();

/**
 * Document parser engine. Controls which backend is used for document parsing.
 *
 * - `'docling'` (default): IBM Docling via docling-serve REST API. Produces
 *   high-quality Markdown with layout understanding, table extraction, and
 *   heading hierarchy, and it runs **on your own infrastructure** — the
 *   `docling` service is part of the default compose stack. Handles PDF, DOCX,
 *   PPTX, XLSX, CSV, images, Markdown and text through one pipeline.
 * - `'legacy'`: the per-format loaders (Claude native PDF, Mammoth DOCX,
 *   SheetJS XLSX, etc.).
 *
 * Docling is the default because the legacy PDF path sends the document to an
 * external model as base64. For a product deployed on customer infrastructure,
 * a default that ships documents off-site is the wrong default.
 *
 * Formats Docling does not handle (SRT, EPUB) always use their legacy loader.
 */
export const DOCUMENT_PARSER = process.env.DOCUMENT_PARSER || 'docling';

export const DOCLING_URL = process.env.DOCLING_URL || 'http://localhost:5001';

/**
 * Whether a Docling failure may fall back to the legacy loaders.
 *
 * Default `true` — a Docling outage degrades to legacy parsing rather than
 * failing the ingest, which is what most deployments want.
 *
 * **Set `DOCLING_STRICT=1` for confidential deployments.** The legacy PDF path
 * sends the document to an external model, so a silent fallback would ship a
 * document off-site precisely when the local parser is unavailable — the exact
 * outcome an isolated deployment is configured to prevent. With strict mode on,
 * the ingest fails loudly instead and the file is marked FAILED.
 */
export const DOCLING_STRICT = process.env.DOCLING_STRICT === '1';

/**
 * Cheap/fast model used for document summarization at ingest time (ADR-16).
 * Defaults to gemini-2.5-flash — observed to be noticeably faster than
 * gpt-5.4-nano for the short-output summary task in our LiteLLM + Bedrock
 * setup, and has strong multilingual support for Polish content. Override
 * via the SUMMARY_MODEL env var. Summaries run per document and cost
 * matters; do not upgrade to a larger model without explicit approval.
 */
export const SUMMARY_MODEL = process.env.SUMMARY_MODEL || 'gemini-2.5-flash';

/**
 * Deployment-level switch for PII masking, mirroring apps/web's flag of the
 * same name. Off by default: Presidio is two extra containers that most
 * deployments don't need, and requiring them to ingest a document made it a
 * hard dependency of the core product.
 *
 * When off, `maskPii` is a no-op — no analyzer calls, and no placeholders in
 * the indexed text. When on, behaviour is unchanged: `piiPolicy` still decides
 * how strict masking is per file, and failures still surface to Temporal.
 */
/**
 * Whether a table Docling parsed becomes its own chunk.
 *
 * Off by default and under measurement — ADR-20 pauses chunking changes until
 * a number exists, and ADR-43 records why 4c was delivered on the parser
 * rather than on ADR-18's prompt. The baseline this is judged against is
 * `apps/web/evals/rag-benchmark/results/2026-09-12-tabele-bilingual-v1-baseline.md`.
 *
 * **Installation-wide, not per organization.** It is deliberately not a
 * `FEATURE_KEYS` entry in `@ragenai/platform-contracts`: that mechanism
 * resolves per organization through four layers, for capabilities an operator
 * sells or grants. A chunking strategy resolved per organization would put two
 * chunk shapes in one Qdrant collection. This belongs with
 * `FEATURE_FLAG_RERANKING` and `DOCUMENT_PARSER`.
 *
 * It changes **CSV and XLSX too**, not only tables inside documents:
 * `DOCLING_SUPPORTED_TYPES` covers spreadsheets and `split-documents.ts`
 * returns to the markdown splitter before the `FileType` switch that would
 * route them to the row-group splitter. A spreadsheet is entirely table, so
 * its chunking changes completely rather than marginally.
 */
export const TABLE_CHUNKS_ENABLED =
  process.env.FEATURE_FLAG_TABLE_CHUNKS === '1';

export const PII_MASKING_ENABLED = process.env.FEATURE_FLAG_PII_MASKING === '1';

export const PRESIDIO_ANALYZER_URL =
  process.env.PRESIDIO_ANALYZER_URL || 'http://presidio-analyzer:3000';

export const PRESIDIO_ANONYMIZER_URL =
  process.env.PRESIDIO_ANONYMIZER_URL || 'http://presidio-anonymizer:3000';

/**
 * The organization the nightly demo cleanup empties — and whose restrictions
 * it re-applies — and how long a conversation there survives after its last
 * message.
 *
 * Named explicitly rather than derived from `TARGET_ENV`: the demo's other
 * restrictions are per-organization feature flags, so "is this the demo" is a
 * property of a tenant, not of a deployment. Deriving it from the environment
 * here would contradict that — and would make a showcase tenant on an
 * ordinary deployment impossible to clean up.
 *
 * Unset means the job does nothing. A scheduled delete should not acquire a
 * target by default.
 *
 * The trade-off, stated because it is a real limit: exactly one organization.
 * A second showcase tenant needs this revisited rather than a second variable.
 */
export const DEMO_ORGANIZATION_ID = process.env.DEMO_ORGANIZATION_ID?.trim();

const DEFAULT_DEMO_THREAD_RETENTION_HOURS = 24;

export const DEMO_THREAD_RETENTION_HOURS = (() => {
  const raw = process.env.DEMO_THREAD_RETENTION_HOURS?.trim();
  if (!raw) {
    return DEFAULT_DEMO_THREAD_RETENTION_HOURS;
  }
  const parsed = Number(raw);
  // A non-numeric or non-positive value must not silently become "delete
  // everything": 0 would make every thread stale the moment it is written.
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_DEMO_THREAD_RETENTION_HOURS;
  }
  return parsed;
})();

const DEFAULT_ANALYTICS_RETENTION_DAYS = 90;

/**
 * How long `document_retrievals` rows survive the nightly prune.
 *
 * Retrieval rows are written on every RAG turn — several per answer, against
 * one per cited document — so this table grows faster than anything else
 * analytics reads, and nothing on the dashboard looks back further than 90
 * days anyway.
 *
 * Same defensive parse as the demo retention above and for the same reason: a
 * non-numeric or non-positive value must not become "delete everything", and
 * 0 would make every row stale the moment it is written.
 */
export const ANALYTICS_RETENTION_DAYS = (() => {
  const raw = process.env.ANALYTICS_RETENTION_DAYS?.trim();
  if (!raw) {
    return DEFAULT_ANALYTICS_RETENTION_DAYS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ANALYTICS_RETENTION_DAYS;
  }
  return parsed;
})();
