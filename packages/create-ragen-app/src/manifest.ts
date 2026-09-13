/**
 * What create-ragen-app changes in the two `.env.example` templates it ships
 * as `.env.local` (root and apps/admin) to turn a fresh clone into a working
 * local install, without asking a question for every variable.
 *
 * This is deliberately an *overrides* list, not a full inventory of every env
 * var: anything not listed here is left exactly as the cloned repo's own
 * `.env.example` already has it (a comment, a blank, or a working default).
 * Only vars that need a generated secret or a corrected local-dev value show
 * up below.
 *
 * `targets` lists every `.env.local` file that must receive this key. When an
 * entry has more than one target, the *same* generated value is written to
 * each of them — that is what makes it "shared" rather than "this key exists
 * in more than one file with independent values" (BETTER_AUTH_SECRET is the
 * latter: root and apps/admin each get their own entry, each scoped to one
 * target, so they resolve to different secrets).
 *
 * Keeping this file in sync with `packages/env/src/fragments.ts` and the two
 * `.env.example` files is enforced by
 * tests/architecture/create-ragen-app-manifest-is-current.test.ts.
 */

export type EnvTarget = 'root' | 'admin';

export interface GenerateSecretEntry {
  key: string;
  strategy: 'generate-secret';
  targets: EnvTarget[];
}

export interface LocalDefaultEntry {
  key: string;
  strategy: 'local-default';
  targets: EnvTarget[];
  value: string;
}

export type ManifestEntry = GenerateSecretEntry | LocalDefaultEntry;

export const MANIFEST: ManifestEntry[] = [
  // --- Generated secrets, independent per target ---
  { key: 'SECRET_KEY', strategy: 'generate-secret', targets: ['root'] },
  { key: 'BETTER_AUTH_SECRET', strategy: 'generate-secret', targets: ['root'] },
  {
    key: 'PUBLIC_LINK_TOKEN_SECRET',
    strategy: 'generate-secret',
    targets: ['root'],
  },
  {
    key: 'SESSION_AUTH_SECRET',
    strategy: 'generate-secret',
    targets: ['root'],
  },
  {
    // Replaces the "worker-secret-key" placeholder that ships in
    // .env.example — apps/worker reads the same var from the root env via
    // scripts/load-root-env.mjs, so one value here is enough.
    key: 'WORKER_SECRET_KEY',
    strategy: 'generate-secret',
    targets: ['root'],
  },
  {
    key: 'BETTER_AUTH_SECRET',
    strategy: 'generate-secret',
    targets: ['admin'],
  },

  // --- Generated secrets, shared value across targets ---
  {
    // Read by apps/web, apps/api and apps/admin (apps/api gap-fills from the
    // root .env.local when it has none of its own, per
    // scripts/load-root-env.mjs, so it never needs a third copy of this
    // value). apps/admin keeps a fully separate env file, so it needs its own
    // copy of the same value.
    key: 'INTERNAL_API_SECRET',
    strategy: 'generate-secret',
    targets: ['root', 'admin'],
  },

  // --- Local-dev defaults that correct a stale example value ---
  {
    // Ships commented out, which leaves apps/web sending no Authorization
    // header while docker-compose.yml starts the proxy *with* a master key
    // (`${LITELLM_MASTER_KEY:-sk-litellm-dev-key}`) — so every call to the
    // proxy came back 401 and the model picker silently fell back to a
    // static list.
    //
    // This is deliberately the same literal as the compose default rather
    // than a generated secret: Compose interpolates `${LITELLM_MASTER_KEY}`
    // from the shell or a root `.env`, and never from `.env.local`. A
    // generated value here would land in the app and not in the container,
    // which is the 401 again with a harder-to-see cause. It is a local-dev
    // credential on a loopback port; a deployed install sets its own.
    key: 'LITELLM_MASTER_KEY',
    strategy: 'local-default',
    targets: ['root'],
    value: 'sk-litellm-dev-key',
  },
  {
    // docker-compose.yml maps Postgres to host port 55432. A native or other
    // Postgres on 5432 would otherwise silently answer instead of the
    // container, and report success against the wrong database. The
    // `.env.example` files used to disagree with this value; they no longer
    // do, and `tests/architecture/docs-name-the-published-service-ports.test.ts`
    // keeps it that way. See docs/lessons.md.
    key: 'DATABASE_URL',
    strategy: 'local-default',
    targets: ['root', 'admin'],
    value: 'postgresql://postgres:pass123@localhost:55432/ragen',
  },
];

export function entriesForTarget(target: EnvTarget): ManifestEntry[] {
  return MANIFEST.filter((entry) => entry.targets.includes(target));
}
