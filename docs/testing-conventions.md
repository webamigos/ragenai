# Testing conventions

Long-form detail split out of `AGENTS.md`, which has a hard 32,768-byte budget (Codex's `project_doc_max_bytes`) — content past that offset is silently dropped. The rules that must always be in context stay in `AGENTS.md`; the mechanics live here.

## Vitest

- Wrap components in `<NextIntlClientProvider messages={...} locale="en">`
- Mock server actions (`vi.mock`) — never hit real APIs
- Mock externals (Stripe, Prisma, logger) that'd fail in jsdom
- Use `vi.hoisted()` for mock functions referenced in `vi.mock()` factories
- `ResizeObserver` polyfill for cmdk/Radix components
- `@testing-library/user-event` for interactions; `waitFor` for async
- Follow existing patterns in `src/store/__tests__/`, `src/app/lib/utils/__tests__/`

## Playwright / E2E

### What is where

- `e2e/constants.ts` — test user and org ids, credentials
- `e2e/helpers.ts` — `ROUTES`, `LABELS`, `login()`, `buildMockSSE()`
- `e2e/seed/e2e-seed.ts` — database seeding, run from `global.setup.ts`
- `e2e/auth.setup.ts` — stores the authenticated session in `.auth/user.json`
- `e2e/fixtures/` — files the upload specs use

### One-time setup

E2E runs against a separate `ragen_e2e` database, so it never touches your dev
data. Once: `createdb ragen_e2e`, run the migrations against it, then create
`.env.e2e.local` overriding `DATABASE_URL` and `DATABASE_DIRECT_URL`.

That file only redirects `apps/web` — `playwright.config.ts` loads it and hands
it to the web server it starts. **`apps/api` has to be pointed at `ragen_e2e`
on its own command line**, or it falls through to the repository root's
`.env.local` and answers from your dev database. It is the sidebar's thread
list, the knowledge base's folders and the versioning fixtures, so getting this
wrong fails about thirty `p0` tests with assertions that look nothing like a
database problem. `.claude/skills/ragen-e2e-triage/SKILL.md` has the command
and the symptoms.

`npm run build` has to succeed before `npm run test:e2e` — the suite drives the
built app, not the dev server. If LiteLLM is not listening on :4000,
`e2e/mock-llm-server.ts` starts on its own.

- All routes use `/pl` locale prefix (Polish UI in assertions)
- Import `ROUTES`/`LABELS` from `e2e/helpers.ts`
- Mock external APIs (S3, Temporal, LLM) via `page.route()` — never hit real backends
- `buildMockSSE()` for streaming chat
- Tests run sequentially (single worker, shared DB state)
- `getByTestId()` for interactive elements; regex for Polish text
- Timeouts: 10s visibility, 15s navigation/login
