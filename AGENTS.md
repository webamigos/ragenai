# AGENTS.md

Guidance for coding agents working in this repository. This is the canonical
file — Claude Code, Codex, Cursor and Copilot all read `AGENTS.md`, and
`CLAUDE.md` is a one-line import of it so both names resolve to the same
content. Edit this file, never the pointer.

> **Instruction budget:** this file must stay under **32,768 bytes** — Codex's
> default `project_doc_max_bytes`. Content past that offset never reaches the
> agent, and nothing warns you. It is enforced:
> `tests/architecture/agent-instructions-fit-the-budget.test.ts` fails 1 KiB
> early, so there is room to act. When it fires, move long-form detail into
> `docs/` and leave a pointer — do not trim the hard rules. That is why most of
> Architecture is pointers, and why `apps/api/AGENTS.md` was split.

## Commands

```bash
docker compose up        # Postgres, Redis, Qdrant, Temporal, LiteLLM
npm run web:dev          # Next.js dev server (apps/web)
npm run web:build        # Production build
npm run verify           # THE gate: generate types, then lint + typecheck + test + build
npm run typecheck        # tsc --noEmit across every workspace
npm run lint             # ESLint across every workspace (or web:lint / api:lint / …)
npm run web:test         # Unit tests. Add a path to run one file.
npm run packages:test    # Workspace package tests
npm run ragen:up:full    # Backing services only (apps run on the host)
npm run ragen:up:everything  # Everything in containers, apps included
npm run generate:types   # Prisma client for every app (root owns the schema)
npm run test:e2e         # Playwright E2E tests (requires ragen_e2e DB)
npm run db:seed          # Seed database (uses .env.local)
npm run docs:dev         # Docusaurus documentation site (apps/docs)
npm run docs:build       # Build the docs site (fails on a broken internal link)
npm run worker:dev       # Temporal worker (apps/worker) in watch mode
npm run worker:test      # Worker Jest suite
npm run check:config-paths   # Fail if a CI-config path glob matches nothing
npx turbo run build      # Build every workspace, in dependency order, cached
npx turbo run build --filter=@webamigos/ragen-api   # ...just one, plus what it needs
```

**E2E** needs a separate `ragen_e2e` database and a successful `npm run build`
first — one-time setup in
[`docs/testing-conventions.md`](docs/testing-conventions.md).

## Task Router

Before starting a nontrivial task, match it against this table and read the linked doc(s) first — and check [`docs/lessons.md`](docs/lessons.md) for the relevant area, so you don't re-discover a known gotcha. Skip this for single-line/obvious fixes.

| Task | Where to look |
|---|---|
| **RAG pipeline** | |
| Retrieval quality, hybrid search, reranking | [`docs/rag-pipeline.md`](docs/rag-pipeline.md), ADRs [11](docs/adrs/11-qdrant-vector-store.md)/[12](docs/adrs/12-cohere-rerank-post-retrieval.md)/[14](docs/adrs/14-hybrid-search-dense-sparse.md), this file's "RAG Pipeline" section |
| Multi-query expansion / rephrasing | ADR [15](docs/adrs/15-multi-query-expansion.md) |
| Document summaries at ingest | ADR [16](docs/adrs/16-document-summaries-at-ingest.md) |
| Chunking strategy, PDF heading detection, section-aware context, table chunks | ADRs [17](docs/adrs/17-type-specific-chunking.md)/[18](docs/adrs/18-pdf-heading-detection.md)/[19](docs/adrs/19-section-aware-context-rendering.md)/[43](docs/adrs/43-table-chunks-come-from-the-parser-not-the-prompt.md) |
| Measuring/evaluating RAG quality changes | ADR [20](docs/adrs/20-pause-and-measure-rag-quality.md), the [2026-09-12 measurement](docs/rag-measurement-2026-09-12.md), [`evals/`](apps/web/evals/README.md) — three harnesses, one tests retrieval |
| **Data & access control** | |
| Vector store, collection schema, why only Qdrant works | [`docs/vector-store.md`](docs/vector-store.md), ADRs [11](docs/adrs/11-qdrant-vector-store.md)/[14](docs/adrs/14-hybrid-search-dense-sparse.md)/[31](docs/adrs/31-only-qdrant-is-a-supported-vector-store.md) |
| Knowledge base folders, sharing, permissions, IDOR concerns | [`docs/knowledge-base.md`](docs/knowledge-base.md) |
| Document versions, diff, rollback, re-indexing after a content change | [`docs/document-versioning.md`](docs/document-versioning.md) |
| RAG optimization suggestions (Suggest & Accept) | [`docs/document-versioning.md`](docs/document-versioning.md) |
| Tenant/org data scoping, cross-org data leaks | [`docs/tenant-scope-guard.md`](docs/tenant-scope-guard.md), this file's "Server Actions — Security" section |
| Prisma schema changes, migrations | this file's "Prisma (v7)" section, ADR [03](docs/adrs/03-prisma-v7-migration.md) |
| Auth, RBAC, permissions, adding an org role | this file's "RBAC" section and [ADR-39](docs/adrs/39-org-roles-are-capabilities-not-a-rank.md) — ask a capability, never compare the role string |
| Thread message encryption, KMS keys | [`docs/thread-encryption.md`](docs/thread-encryption.md), ADRs [02](docs/adrs/02-per-org-kms-keys.md)/[06](docs/adrs/06-thread-message-encryption.md)/[42](docs/adrs/42-thread-derived-content-is-encrypted-through-one-function.md) — anything derived from a thread goes through one function, never a second branch |
| **Integrations** | |
| MCP connectors (Slack/HubSpot/ClickUp/Google/Fireflies) | [`docs/mcp-integrations.md`](docs/mcp-integrations.md), ADR [05](docs/adrs/05-mcp-integration-strategy.md) |
| Connector OAuth flows, where tokens are stored | [`docs/token-vault.md`](docs/token-vault.md), ADR [32](docs/adrs/32-token-vault-and-mcp-stay-separate.md) |
| Whether a sibling repository belongs in the monorepo | [ADR-32](docs/adrs/32-token-vault-and-mcp-stay-separate.md) — measure drift first |
| Where a new admin page or read belongs — `apps/web` or `apps/admin` | [ADR-35](docs/adrs/35-two-admin-surfaces-split-by-scope.md) — per-org is web, platform-wide is admin |
| Adding a feature flag, a model, or an MCP connector | [`packages/platform-contracts`](packages/platform-contracts/src) and [ADR-33](docs/adrs/33-shared-platform-contracts-package.md) — declare it once, never per app |
| Adding or validating an environment variable | [`packages/env`](packages/env/src) and [ADR-37](docs/adrs/37-typed-env-contract-not-a-config-file.md) — compose a fragment, don't re-describe a shared var |
| Extending Ragen without changing core — plugins | [ADR-38](docs/adrs/38-mcp-is-the-plugin-api-no-in-process-plugin-runtime.md) — MCP is the extension API; nothing loads in-process |
| LiteLLM / model routing / adding a model | [`docs/litellm-proxy.md`](docs/litellm-proxy.md), `infra/litellm/config.yaml` |
| OpenRouter routing, EU region, zero data retention | [`docs/model-routing.md`](docs/model-routing.md) |
| Public API, opaque API keys | ADR [13](docs/adrs/13-opaque-api-keys.md), this file's "API" section |
| Chatbot embed widget | [`docs/chatbot-integration-followups.md`](docs/chatbot-integration-followups.md) |
| **Monorepo & apps/api** | |
| Monorepo task graph, caching, adding a workspace | this file's "Monorepo tasks (Turborepo)" section, `turbo.json` |
| Where a module, route or library lives | [`docs/architecture.md`](docs/architecture.md) |
| Running the whole ecosystem locally, ports, companion services | [`docs/companion-services.md`](docs/companion-services.md) |
| Documentation site, published docs, self-hosting guide | [ADR-30](docs/adrs/30-absorb-ragen-docs-into-monorepo.md), `apps/docs/docs/` |
| Anything touching `apps/api`, the NestJS port, or what's been cut over vs. stays local | [ADR-21](docs/adrs/21-monorepo-and-api-decoupling.md) (read the latest updates first), `apps/api/AGENTS.md` |
| Document ingest, Temporal workflows, anything in `apps/worker` | [ADR-26](docs/adrs/26-absorb-ragen-worker-into-monorepo.md), [ADR-40](docs/adrs/40-worker-uses-prisma-not-knex.md) — its data layer is knex, migrating, `apps/worker/AGENTS.md` |
| Writing or reviewing a spec before building | [`docs/specs/README.md`](docs/specs/README.md), [`docs/specs/TEMPLATE.md`](docs/specs/TEMPLATE.md) |
| **Testing & ops** | |
| Document ingest file types, PDF/DOCX/XLSX handling | [`docs/document-processing.md`](docs/document-processing.md) |
| Settings pages, per-permission nav | [`docs/settings-pages.md`](docs/settings-pages.md) |
| Any panel UI — layout, tables, empty states, copy | [`docs/panel-ux-rules.md`](docs/panel-ux-rules.md) |
| Uploading, storing or serving a file; S3 vs local | [`docs/file-storage.md`](docs/file-storage.md), ADR [27](docs/adrs/27-storage-abstraction-local-by-default.md) |
| A side-effect on a lifecycle event (welcome email, signup) | [`docs/event-bus.md`](docs/event-bus.md) |
| Unit/component tests | this file's "Testing Requirements" section |
| E2E tests, regression sweep before a release | this file's "E2E Tests" section, [`docs/regression-checklist.md`](docs/regression-checklist.md) |
| Security incidents, PII alerting | [`docs/security-monitoring.md`](docs/security-monitoring.md) |
| LiteLLM version upgrades | [`docs/runbooks/litellm-upgrade.md`](docs/runbooks/litellm-upgrade.md) |
| Docling version upgrades | [`docs/runbooks/docling-upgrade.md`](docs/runbooks/docling-upgrade.md) |
| Presidio version upgrades, PII test scenarios | [`docs/runbooks/presidio-upgrade.md`](docs/runbooks/presidio-upgrade.md) |
| Upgrading any dependency, or clearing an npm audit advisory | [`.claude/skills/ragen-upgrade-dependency/SKILL.md`](.claude/skills/ragen-upgrade-dependency/SKILL.md) — read it before a bump that touches a library owning DB tables |
| Load testing, or proving who can reach a document | [`apps/web/perf/README.md`](apps/web/perf/README.md) |
| An E2E failure: real regression or your own setup | [`.claude/skills/ragen-e2e-triage/SKILL.md`](.claude/skills/ragen-e2e-triage/SKILL.md) |
| Changing retrieval — chunking, embeddings, reranking, prompts | [`.claude/skills/ragen-rag-change/SKILL.md`](.claude/skills/ragen-rag-change/SKILL.md) — measure, per ADR-20 |
| A query missing its org scope, or the IDOR backlog | [`.claude/skills/ragen-tenant-scope-audit/SKILL.md`](.claude/skills/ragen-tenant-scope-audit/SKILL.md) |
| Reviewing a change against this repo's own invariants | [`.claude/skills/ragen-code-review/SKILL.md`](.claude/skills/ragen-code-review/SKILL.md) |

## Core Surfaces

Four apps and a worker share one schema and ten packages, so some files are
read by code you are not looking at. Before changing one of these, know who
else depends on it — and run `npm run verify`, which is the only command that
checks all of them at once.

| Surface | Who depends on it | What catches a mistake |
|---|---|---|
| `prisma/schema.prisma` | every app, via per-app `generator` blocks | a migration, plus `npm run verify` — one `prisma generate` regenerates all clients |
| `packages/rag-core` | web, api, worker | package tests + each consumer's build |
| `packages/crypto` | web, api, worker | package tests, plus `tests/architecture/encryption-lives-in-one-package.test.ts` |
| `packages/storage`, `observability`, `vault-client` | web, api, worker | as above |
| `packages/platform-contracts` | web, api, admin | package tests, plus `tests/architecture/shared-contracts-are-not-recopied.test.ts` |
| `packages/litellm-client` | web, api, admin | package tests, plus each consumer's build |
| `packages/env` | api, worker, mcp | package tests, plus each app's own env schema tests |
| `packages/create-ragen-app` | every new self-hosted install | its own tests + `tests/architecture/create-ragen-app-manifest-is-current.test.ts` |
| `src/lib/auth-guards.ts`, `auth-access-control.ts` | every authenticated route and Server Action | `apps/admin`'s `server-actions-are-guarded` test |
| `src/libs/db/tenant-scope-guard.ts` | ~20 tenant-scoped models | warns at runtime; it does **not** block |
| Better Auth tables (`users`, `sessions`, `accounts`, `members`, …) | the library's own queries | `tests/architecture/` |
| `infra/litellm/config.yaml` | every model call | nothing automated — see the runbook |

Two rules that come from things that actually broke here:

- **A library that owns a table also owns how it is queried.** Writing one of
  its rows directly with Prisma couples you to queries you cannot see, and an
  upgrade can start filtering on a column that was previously write-only.
  Prefer the library's API; if you must write the row, check what the current
  version reads. `tests/architecture/` is the tripwire for the case that cost
  us a red `main`.
- **A red required check is red for a reason.** `test-e2e` is the only gate
  that exercises sign-in end to end. Nothing else in CI would have caught the
  regression it caught.

Architecture guards live in `tests/architecture/` and run in `Packages / Test`.
They read source as text, so one test can speak for the whole monorepo. Add one
whenever a rule matters more than a comment can enforce.

## Local Development

Node.js 24.x (Active LTS). One `.env.local` at the repository root serves every
app: real env vars beat an app's own `.env` files, which beat the root's — see
`scripts/load-root-env.mjs`. Minimum root `.env.local`:

```
DATABASE_URL="postgresql://postgres:pass123@localhost:55432/smartrag"
QDRANT_URL=http://localhost:6333
LITELLM_PROXY_URL=http://localhost:4000
LITELLM_MASTER_KEY=sk-litellm-dev-key
DEFAULT_MODEL_PROVIDER=litellm
DEFAULT_MODEL=gemini-3-flash-preview
```

App dev ports: **web 3000**, **admin 3200**, **docs 3400** — 3100 is ragen-token-vault and 3001 is apps/api. `next dev` and `docusaurus start` both default to 3000, so every app but web pins `--port`.

Service ports on the host: **Postgres 55432**, **Redis 56379**, Qdrant 6333,
Temporal 7233 (UI 8080), LiteLLM 4000. Inside the compose network each service
still listens on its standard port — only the published mapping moved, and
every one is overridable (`POSTGRES_PORT`, `REDIS_PORT`, …).

**Postgres and Redis are on non-standard ports on purpose.** A native Postgres
on 5432 answers instead of the container, and `prisma migrate` or `psql -h
localhost` then talks to the wrong database *while reporting success* — twice
now. Check which server answers before believing a schema problem. Qdrant and
LiteLLM keep standard ports because the app falls back to them in code, so
moving those would turn each fallback into a trap.
See [`docs/lessons.md`](docs/lessons.md).

Optional local observability: `docker compose --profile observability up -d`,
then point the app at it with `OTEL_EXPORTER_OTLP_ENDPOINT` — see
[ADR-22](docs/adrs/22-observability-opentelemetry.md).

## Architecture

**Stack**: Next.js 16 (App Router) + React 19 + TypeScript ~5.7 + Tailwind 4 + Postgres (Prisma 7) + Qdrant (hybrid dense+sparse) + Temporal.io + LiteLLM proxy + Scaleway reranker. Redis is optional (rate limiting only).

**What it is**: RAG AI chat app with unified LLM gateway (LiteLLM), document knowledge bases, and a public API.

**Monorepo layout**: npm workspaces, `apps/*` + `packages/*` — five apps
(`web`, `api`, `admin`, `worker`, `docs`) over ten packages, with one
`prisma/schema.prisma` serving all of them via per-app `generator` blocks, and
the supporting services in `infra/`. The tree, what each package is for and why
it exists: [`docs/architecture.md`](docs/architecture.md).

**Path convention in this file**: a bare `src/…` means `apps/web/src/…`. Paths in
any other workspace are always written in full (`apps/api/src/…`,
`packages/rag-core/src/…`).

### Monorepo tasks (Turborepo)

Full detail — the ESLint entry points, the caching numbers, why there is no
remote cache: [`docs/monorepo-tasks.md`](docs/monorepo-tasks.md). The rules:

- **ESLint is one shared flat config**, `packages/eslint-config`, with three
  entry points (`base`, `/next`, `/node`). Change a rule for everyone in the
  package; change one app in its own file.
- **Do not re-add manual `packages:build &&` prefixes to scripts.** `turbo.json`'s
  `dependsOn: ["^build"]` already orders package builds, and the prefixes
  defeated the cache.
- **`outputs` must name the build product only.** It excludes `.next/cache/**`
  *and* `.next/dev/**` — the second matters as much and is easy to lose; it once
  filled the disk and took Docker and Postgres with it. Re-check after a Next
  major:
  [`docs/lessons/turbo-cached-the-turbopack-dev-cache.md`](docs/lessons/turbo-cached-the-turbopack-dev-cache.md).

### RAG Pipeline

Four composed improvements (ADRs 11, 12, 14, 15, 16), gated differently: hybrid
search always runs; multi-query is a per-org setting, default on — there is no
`FEATURE_FLAG_MULTI_QUERY`; **reranking is opt-in**, needing
`FEATURE_FLAG_RERANKING=1` plus provider credentials. Two queries per turn
(`MULTI_QUERY_VARIANT_COUNT = 1`). Diagrams, the per-stage table and the flags:
[`docs/rag-pipeline.md`](docs/rag-pipeline.md) — see the Task Router.

### Routing & Layouts

Locale-prefixed (`/en`, `/pl`) via `next-intl`; all UI under
`src/app/[locale]/`, split into `(panel)/`, `(auth)/` and `public/`. Middleware
(`src/middleware.ts`) does i18n and cookie checks only — **real auth
verification happens in server components and layouts**, never in middleware.
See [`docs/architecture.md`](docs/architecture.md).

### Feature Modules (`src/features/`)

CQRS per feature — `contracts/`, `constants/`, `services/queries/` (named
`get*Query()`), `services/commands/` (named `*Command()`), `utils/`. The layout
and the module list: [`docs/architecture.md`](docs/architecture.md).

**Conventions**:
- Queries return data directly; commands return results or `OperationResult<T>`
- Import types from `@/features/{feature}/contracts/` (NOT `@/app/contracts/` or `@/app/lib/types/`)
- Import logic from `@/features/{feature}/services/` (NOT `@/app/lib/services/`)
- Server actions in `src/app/actions/index.ts` delegate to feature commands/queries
- New domain logic goes in `src/features/`, not in actions files

### API

The public API is **`apps/api`** (NestJS). `apps/web`'s `src/app/api/v1/` is
internal and called by `apps/api` only — it is protected by the
`INTERNAL_API_SECRET` shared secret, so never expose one of those routes
directly. API keys are opaque (`sk-<keyId>.<secret>`) and carry no org context;
they live in ragen-token-vault and the database holds only `maskedValue`
([ADR-13](docs/adrs/13-opaque-api-keys.md)). Headers, the chat endpoint and
API-only mode: [`docs/architecture.md`](docs/architecture.md).

### Auth

Better Auth (`src/lib/auth.ts`) with the `admin` and `organization` plugins.
Two org records exist per organization and both matter: Better Auth's
`Organization` owns membership, Ragen's `InternalOrganization` owns app data
(projects, API keys, subscriptions). A user-creation hook makes both plus a
default project. Detail: [`docs/architecture.md`](docs/architecture.md).

### RBAC — Two distinct role hierarchies (never confuse)

| Level | Field | Values | Purpose |
|---|---|---|---|
| **App** | `User.role` | `'admin'`, `'user'` | Platform admin (disk/AI usage dashboards) |
| **Org** | `Member.role` | `'owner'`, `'admin'`, `'member'` | Per-org permissions |

- The vocabulary is `@ragenai/platform-contracts`: `ORG_ROLES`, the `ORG_*_ROLE` constants, `canManageOrg()` (may act), `orgVisibilityScope()` (may see → `DocumentActor.scope`), `canOwnOrg()`, `hasOrgRole()`, `isAppAdmin(user)`. No `isOrgAdmin` — it meant both (ADR-39). `src/lib/auth-access-control.ts` re-exports them, and adds the Better Auth `orgRoles`/`platformRoles` registries; **a new org role goes in both**, and `org-roles.test.ts` asserts they agree.
- `src/lib/auth-guards.ts` — **server-only**: async guards (`requireAppAdmin()`, `requireOrgAdmin()`, `requireOrgOwner()`), cached session/member lookups (`getSession()`, `getActiveMember()`)
- **Never inline a role comparison** — `tests/architecture/role-checks-are-not-inlined.test.ts` fails on `role === 'admin'` outside it. Do NOT duplicate `getActiveMember` in action files.

### State Management

Redux Toolkit (`src/store/`) for client UI state — use the typed hooks in
`src/store/hooks.ts`, not bare `useDispatch`/`useSelector`. Four React
Contexts alongside it, and server state comes from Prisma in server components
and actions. See [`docs/architecture.md`](docs/architecture.md).

### Prisma (v7)

Uses `@prisma/adapter-pg`. Config: `prisma.config.ts` (excluded from tsconfig). Schema: `prisma/schema.prisma`. Client singleton: `src/libs/db/index.ts` (aliased `@ragenai/prisma-client`). Generated output: `src/generated/prisma/` (gitignored, `npm run generate:types`).

`prisma/schema.prisma` is the **single shared schema for the whole monorepo**: each app gets its own client from a `generator` block in that one file, and one `prisma generate` at the root regenerates all of them. Do not create a separate schema for another app — add another `generator` block here instead. Why, and which block belongs to which app: [ADR-21](docs/adrs/21-monorepo-and-api-decoupling.md).

Import `PrismaClient`, enums, and types from `@/generated/prisma/client`. Webpack auto-redirects this to `@/generated/prisma/browser` in client components.

**Tenant-scope guard (warn-only)**: a Prisma Client Extension that logs a
warning when a query on a tenant-scoped model runs without its org field. It
covers ~20 models with a direct org column and **does not cover** models scoped
only through a relation (`Message`, `ThreadDocument`, `DocumentPermission`,
`ProjectPermission`, `ThreadShare*`). It **warns, it does not throw** — it is
not a substitute for getting the `where` clause right. The model map lives once,
in `@ragenai/platform-contracts` (ADR-33). Full detail:
[`docs/tenant-scope-guard.md`](docs/tenant-scope-guard.md).

### Libraries (`src/libs/`)

Sixteen modules. What each is for, and the two that carry a warning:
[`docs/architecture.md`](docs/architecture.md).

### Knowledge Base

Moved to [`docs/knowledge-base.md`](docs/knowledge-base.md) — see the Task Router.

### Document Versions & RAG Optimization

Moved to [`docs/document-versioning.md`](docs/document-versioning.md) — see the Task Router.

Two rules that bite if you miss them: **never re-index a content change with
`runFileEmbeddings`** (it re-parses the stored file, which still holds the
original upload) and **never overwrite the stored file to make it pick up new
text** (that destroys a non-plaintext original). Use
`Workflow.REINDEX_DOCUMENT_VERSION`, which embeds the version text and clears
the previous chunks first.

### Document Processing

Moved to [`docs/document-processing.md`](docs/document-processing.md) — see the Task Router.

### Thread Message Encryption

Moved to [`docs/thread-encryption.md`](docs/thread-encryption.md) — see the Task Router.

### Vector Store (Qdrant, Hybrid)

Moved to [`docs/vector-store.md`](docs/vector-store.md) — see the Task Router.

### MCP Integrations

Moved to [`docs/mcp-integrations.md`](docs/mcp-integrations.md) — see the Task Router.

### Settings Pages

Moved to [`docs/settings-pages.md`](docs/settings-pages.md) — see the Task Router.

### Server Actions

`src/app/actions/index.ts` — auth-wrapped actions delegating to feature module queries/commands. Component-level actions co-located with components.

**Security (critical)**:
- **Never trust client-supplied `orgId`/`userId`** — always derive from session via `getOrgIdFromAuthOrThrow()`, `getOrgIdFromAuth()`, `getCurrentUserId()`
- Scope all user-data queries by `organization_id` (IDOR prevention) — `src/libs/db/tenant-scope-guard.ts` logs a warning if you forget on a covered model, but it doesn't block the query yet; don't rely on it instead of getting the `where` clause right
- `dangerouslySetInnerHTML` only with DOMPurify
- Never expose API keys via `NEXT_PUBLIC_`
- Use `crypto.timingSafeEqual()` for secret comparisons

## Path Aliases

```
@/*                    → apps/web/src/*
@/temporal/*           → apps/web/temporal/src/*
@ragenai/common-ui/*   → apps/web/src/libs/common-ui/*
@ragenai/prisma-client → apps/web/src/libs/db
```

## Key Conventions

- **Environment variables**: a variable read by more than one app belongs in a `@ragenai/env` fragment, not in each app's schema (ADR-37). Use `httpUrl()` for endpoints — `z.string().url()` accepts `localhost:4318`, because `new URL()` reads `localhost:` as a scheme. Services validate at boot and exit; `apps/web` must not, since it serves the setup page that explains the fix.
- **Panel colour and density** (design system v2 — the full palette and
  crimson's five rationed jobs are in
  [`docs/panel-ux-rules.md`](docs/panel-ux-rules.md)): navy is the only
  *non-destructive* action colour; crimson is destructive-and-reserved; green
  and amber encode document or job state and nothing else; state never rests on
  colour alone, so a badge always carries a word or a percentage. Use the
  semantic tokens (`bg-primary`, `text-muted-foreground`, `border-border`),
  never a literal Tailwind colour — enforced by
  `tests/architecture/panel-colours-are-tokens-not-literals.test.ts`, which
  fails the build on a ramp step, bare white/black or a hex and lists the few
  things that genuinely cannot be a token.
- **Braces required**: always use braces for `if`/`else`/`for`/`while` — no single-line bodies. Enforced by ESLint `curly` in `@ragenai/eslint-config`, so it applies to every workspace, not just `apps/web`.
- **ESM**: `"type": "module"` — all `.js` are ESM. CommonJS scripts use `.cjs`. `moduleResolution: "bundler"` — no deep internal imports (e.g. `langchain/dist/...`).
- Server components by default; client components mark with `'use client'`.
- All API routes use `export const dynamic = 'force-dynamic'`.
- Prisma IDs: `Int` autoincrement `id` (internal) + `publicId` UUID (external/URLs). Better Auth tables keep String IDs.
- All Prisma fields use camelCase with `@map('snake_case')` for DB columns.
- Timestamps use `Timestamptz`; default TZ Europe/Warsaw.
- i18n: `en`/`pl` via `next-intl`. Use `Link`/`redirect`/`usePathname`/`useRouter` from `@/i18n/routing` (NOT `next/link` or `next/navigation`).
- Tailwind v4 with `@theme` directive in `src/app/[locale]/global.css`. Brand colors: Ragen red `#cb1d3d`, Ragen blue `#252d53`.
- Error classes: `UnauthorizedException`, `NotFoundException`, `LimitExceededException`. Temporal workflows: reference by string name, not function import.
- Logging: Pino w/ OpenTelemetry; webpack swaps server → client logger on client builds.
- Observability: OTel traces/metrics/logs via `src/instrumentation.ts` + `instrumentation-client.ts`; auto-instrumentation covers HTTP, Postgres, Prisma and outgoing `fetch`. **All of it is a no-op unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.** LLM tracing is LiteLLM → Langfuse, not app OTel. See [ADR-22](docs/adrs/22-observability-opentelemetry.md).
- Pre-commit: lint-staged runs `eslint --fix` + `prettier --write`, dispatching each file to its own workspace in `lint-staged.config.mjs` — add an entry there when you add a workspace. Conventional commits, enforced by commitlint.

## LiteLLM Proxy

Moved to [`docs/litellm-proxy.md`](docs/litellm-proxy.md) — see the Task Router.

## Model Defaults

- **Chat**: env `DEFAULT_MODEL`, falling back to `gemini-3-flash-preview` (`defaultOrganizationSettings.model`). `gpt-5.4` is provisioned but not the default.
- **Rephrase / multi-query expansion**: `gemini-2.5-flash` — do not upgrade without explicit approval
- **Summary** (worker, ADR-16): `gemini-2.5-flash` — faster than `gpt-5.4-nano` for short outputs, strong Polish. Set via `SUMMARY_MODEL` in `apps/worker/src/consts.ts`.
- Always verify against `infra/litellm/config.yaml` (older docs mentioned `gpt-4o`/`gpt-4.1-nano` which are no longer provisioned).

## Per-Org Model Management

- `OrganizationSettings.allowedModels` (`String[]`, default `[]`) — empty = no restriction (back-compat)
- Filtered in `getAvailableModelsForOrganization()` (`src/app/lib/actions/checkAvailableProviders.ts`)
- Defaults in `Settings` table key `default_allowed_models`, applied to new orgs via `applyDefaultLimitsToOrg()`
- Admin UI: `apps/admin/src/app/(dashboard)/models/`
- Key functions in `src/features/organizations/services/organization-settings.ts`: `getAllowedModels()`, `saveAllowedModels()`, `getDefaultAllowedModels()`, `saveDefaultAllowedModels()`

## Testing Requirements

All new code must include tests. Vitest + React Testing Library (`jsdom`). Tests live next to code in `__tests__/` directories.

| File type | Tests required |
|---|---|
| Utility functions | Unit tests |
| Redux slices | Unit tests for all reducers |
| Zod schemas | Unit tests valid + invalid inputs |
| React components | Integration tests (render, interaction, state) |
| New screens/pages | At minimum a Playwright smoke test |
| Workspace packages (`packages/*`) | Unit tests beside the source. They run in the root `App / Test` job (vitest's `include` covers `packages/*/src`) and count toward coverage |
| Thin bindings / adapters | A test for whatever they wire. A five-line file that injects a logger or picks a service name is still the only place that wiring exists, and it fails silently when it breaks |

This is not aspirational — a PR adding code with no test is incomplete. The cases
most often missed are the two rows above: shared package code, and the small
per-app files that bind it.

**Vitest and Playwright conventions**: [`docs/testing-conventions.md`](docs/testing-conventions.md).

### E2E Tests (Playwright)

Live in `e2e/`, against a seeded local database with a pre-authenticated test
user. What each file there is for:
[`docs/testing-conventions.md`](docs/testing-conventions.md).

**Naming**: `{priority}-{##}-{name}.spec.ts` where priority is `smoke-01..06` (unauth), `smoke-07+` (auth), `p0-*` (critical), `p1-*` (high), `p2-*` (medium), `p3-*` (low/admin/edge cases).

**The prefix decides when CI runs it.** A PR runs only `smoke-*` and `p0-*` (82 of 175 tests); the full suite runs on push to `main` and nightly. So a `p1`–`p3` test will not gate the PR that breaks it — put anything that must block a merge in `smoke-*` or `p0-*`. Run everything locally with `npm run test:e2e`, or just the fast tier with `npx playwright test "(smoke|p0)-"`.

**Conventions**: see [`docs/testing-conventions.md`](docs/testing-conventions.md).

### Manual Regression Checklist

`docs/regression-checklist.md` — prioritized P0–P3 scenarios across auth, chat, KB, projects, connectors, settings, API. Use before releases.

## Post-Task Workflow

After modifying or creating files:

1. **Write tests first** — unit/integration tests for all new code (see Testing Requirements above).
2. **Run the gate** — `npm run verify`. It is the one command that covers every workspace; `npx vitest run` alone misses typecheck and the other apps.
3. **Run code review** — `/coderabbit:review` before reporting completion.
4. **Changed what a fresh install needs?** A new/renamed env var, a service the app can no longer run without, a changed default model or vector size, a compose change — update `packages/create-ragen-app` in the same PR and **say so in the description**. Nothing else exercises the first-run path; what counts is listed in its [README](packages/create-ragen-app/README.md).
5. **Log a lesson if you hit one** — if you made a nontrivial correction or found a non-obvious gotcha, add/update an entry in [`docs/lessons.md`](docs/lessons.md) (see that file's own instructions).
