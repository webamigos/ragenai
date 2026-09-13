import {
  fragments,
  requiredForProvider,
  allOrNone,
  requiredInDeployedEnvs,
} from '@ragenai/env';
import { z } from 'zod';

import { parseMasterKey } from '@ragenai/crypto';

/**
 * The worker's environment contract.
 *
 * The shared halves — TARGET_ENV, the database, the LiteLLM gateway, Qdrant,
 * OTel, storage — come from `@ragenai/env` (ADR-37), so the worker and the
 * app cannot disagree about what a valid `OTEL_SERVICE_NAME` or
 * `STORAGE_PROVIDER` looks like. Only what is genuinely worker-local is
 * spelled out here.
 *
 * `targetEnvRequired`, not `targetEnv`: a deployed service must say which
 * environment it is in rather than defaulting to `local` and quietly
 * disabling the staging/production rules below.
 */
const envSchema = fragments.targetEnvRequired
  .merge(fragments.database)
  .merge(fragments.litellm)
  .merge(fragments.qdrant)
  .merge(fragments.observability)
  .merge(fragments.storage)
  .merge(fragments.encryption)
  .extend({
    TEMPORAL_SERVER_ADDRESS: z.string(),
    TEMPORAL_NAMESPACE: z.string().optional(),
    TEMPORAL_CERT: z.string().optional(),
    TEMPORAL_KEY: z.string().optional(),

    // Redis for organization settings
    REDIS_URL: z.string().url(),
    SECRET_KEY: z.string(), // for hashing organization settings in Redis

    // Meilisearch (legacy — kept for backwards compatibility)
    MEILISEARCH_URL: z.string().url().optional(),
    MEILISEARCH_API_KEY: z.string().optional(),

    // Scaleway Generative APIs (used by LiteLLM)
    SCW_API_BASE: z.string().url(),
    SCW_API_KEY: z.string().min(1),

    // Embeddings model name (must match infra/litellm/config.yaml model_name)
    EMBEDDINGS_MODEL: z.string(),

    // Pusher (optional — not needed for on-premise SSE mode)
    PUSHER_APP_ID: z.string().optional(),
    PUSHER_KEY: z.string().optional(),
    PUSHER_SECRET: z.string().optional(),

    // PDF processing
    PDF_PROCESSOR: z.enum(['claude', 'vision']).default('claude'),
    PDF_MODEL: z.string().default('claude-haiku-4-5'),

    // Firecrawl (optional — web scraping disabled when absent)
    FIRECRAWL_API_KEY: z.string().optional(),

    // Ragen App (usage reporting)
    RAGEN_APP_URL: z.string().url().optional(),
    WORKER_SECRET_KEY: z.string().optional(),

    // Demo showcase organization (nightly thread cleanup).
    // Optional everywhere: unset means the cleanup job does nothing, which is
    // the correct state for every deployment that is not the demo.
    // Deliberately not `.uuid()`: `Organization.id` is a plain String owned by
    // Better Auth, so the id format is the library's to choose. A stricter
    // check here would refuse to boot over an id the database is perfectly
    // happy with.
    DEMO_ORGANIZATION_ID: z.string().min(1).optional(),
    DEMO_THREAD_RETENTION_HOURS: z.coerce.number().positive().optional(),

    // How long `document_retrievals` rows are kept (nightly prune). Optional:
    // unset means the 90-day default. `.positive()` because 0 would not mean
    // "keep nothing", it would mean "delete every row the moment it is
    // written", which is a configuration mistake and not a choice anyone
    // makes on purpose.
    ANALYTICS_RETENTION_DAYS: z.coerce.number().positive().optional(),

    /**
     * Table chunking, under measurement (ADR-43). `'1'` turns it on.
     *
     * Declared here because nothing else catches a typo: this schema is a
     * non-strict Zod object, so an unknown key is stripped silently, and
     * `DOCLING_STRICT`, `DOCUMENT_PARSER` and the existing `FEATURE_FLAG_*`
     * variables are all undeclared for that reason. Declaring it still does
     * not catch a misspelling in the *deployment* — `FEATURE_FLAG_TABLE_CHUNK`
     * is simply absent, not invalid — which is why the resolved value is also
     * logged once per ingest.
     */
    FEATURE_FLAG_TABLE_CHUNKS: z.enum(['0', '1']).optional(),

    // Langfuse
    LANGFUSE_PUBLIC_KEY: z.string().optional(),
    LANGFUSE_SECRET_KEY: z.string().optional(),
    LANGFUSE_HOST: z.string().url().optional(),
  })
  .superRefine((env, ctx) => {
    requiredForProvider(env, ctx, 'STORAGE_PROVIDER', 's3', [
      'S3_BUCKET_NAME',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ]);

    // The worker validated none of the encryption variables until now, which
    // is why a provider it could not construct read as "encryption not
    // configured" and turned dual-content PII into masked-only on every
    // ingest, with one warning per document. Refusing to boot is the whole
    // point: a misconfigured key is not something to discover from the
    // absence of encrypted originals weeks later.
    requiredForProvider(env, ctx, 'ENCRYPTION_PROVIDER', 'scaleway', [
      'SCW_KEY_MANAGER_KEY_ID',
      'SCW_API_KEY',
    ]);
    requiredForProvider(env, ctx, 'ENCRYPTION_PROVIDER', 'kms', [
      'AWS_KMS_KEY_ID',
    ]);
    requiredForProvider(env, ctx, 'ENCRYPTION_PROVIDER', 'local', [
      'ENCRYPTION_MASTER_KEY',
    ]);

    // Present is not the same as usable. `requiredForProvider` only checks
    // that the variable is non-empty, so `ENCRYPTION_MASTER_KEY=x` booted and
    // then threw when LocalKeyProvider was first constructed — inside an
    // ingest activity, hours later, where the failure reads as an encryption
    // problem rather than a typo in the environment.
    const masterKey = env.ENCRYPTION_MASTER_KEY;
    if (env.ENCRYPTION_PROVIDER === 'local' && typeof masterKey === 'string') {
      try {
        parseMasterKey(masterKey);
      } catch (err) {
        ctx.addIssue({
          code: 'custom',
          message: err instanceof Error ? err.message : String(err),
          path: ['ENCRYPTION_MASTER_KEY'],
        });
      }
    }

    // Unconditional, where this used to accept MEILISEARCH_API_KEY as a
    // substitute. That escape hatch predates ADR-31 and is now actively
    // harmful: every ingest activity in activities/meilisearch/ delegates to
    // qdrantService, and qdrant.ts falls back to http://localhost:6333 when
    // QDRANT_URL is unset. So a deployed worker configured "Meilisearch only"
    // boots happily and writes every vector to a Qdrant inside its own
    // container — the workflow succeeds and the chunks are unreachable.
    // Refusing to boot turns a silent data loss into a legible error.
    requiredInDeployedEnvs(
      env,
      ctx,
      ['QDRANT_URL'],
      'Qdrant is the only supported vector store (ADR-31), and it falls back to localhost when unset',
    );

    requiredInDeployedEnvs(env, ctx, ['LITELLM_MASTER_KEY']);

    allOrNone(
      env,
      ctx,
      ['PUSHER_APP_ID', 'PUSHER_KEY', 'PUSHER_SECRET'],
      'Pusher',
    );
  });

export const validateEnvs = () => envSchema.safeParse(process.env);
