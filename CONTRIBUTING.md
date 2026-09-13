# Contributing to Ragen

Thanks for wanting to help. This guide covers how we branch, what we expect in a
pull request, and the handful of things about this codebase that reliably trip
people up.

## Before you start

- **Bugs and small fixes** — open a PR directly. No need to ask first.
- **New features or anything architectural** — open an issue first so we can
  agree on the approach before you spend time on it.
- **Security vulnerabilities** — do **not** open an issue. See
  [SECURITY.md](SECURITY.md).

## Branch model

- `main` — the trunk. **Base your work here and target it in PRs.** Every
  commit is deployable, and releases are cut from it.
- Topic branches — one per change, named `feat/…`, `fix/…`, `chore/…`,
  `refactor/…` or `docs/…`.

There is no long-lived integration branch: `dev` was retired in September 2026,
and a PR opened against a branch other than `main` gets no CI at all — the
workflow triggers on `pull_request: branches: [main]`, and retargeting an
existing PR does not start a run either.

## Getting set up

Node.js 24.x and Docker. Full instructions are in
[AGENTS.md](AGENTS.md#local-development); the short version:

```bash
npm run ragen:up:full      # Postgres, Qdrant, Temporal, LiteLLM, Docling, Redis
npm install
npm run generate:types     # generate the Prisma client — required before anything builds
npm run web:dev
```

Or skip all of it and use **GitHub Codespaces**: open the repository, `Code →
Codespaces → Create codespace`, and you get the same Node, the same services
and a database already migrated. What it does and where it stops is in
[`.devcontainer/README.md`](.devcontainer/README.md).

`npm run generate:types` is not optional. The Prisma client is gitignored and
generated from `prisma/schema.prisma`, so a fresh checkout has no client at all.

## Before you open a PR

Run the same gate CI runs, in this order:

```bash
npm run generate:types     # regenerate if you touched prisma/schema.prisma
npx tsc --noEmit -p .      # NOTE: does not cover apps/api
npm run lint
npx vitest run
npm run api:build          # the only thing that typechecks apps/api
```

`npm run test:e2e` (Playwright) needs a seeded `ragen_e2e` database and a
production build first — CI runs it, so you usually don't have to.

## Three things that catch everyone

**1. `apps/api` keeps its own copies.** The RAG engine, vector store,
connectors, crypto and storage libs exist twice — once in `src/libs/`, once in
`apps/api/src/`. A fix in one usually needs the same edit in the other, and the
root `tsc -p .` does **not** cover `apps/api`. Always run `npm run api:build`.
Details: [`apps/api/docs/ported-libs.md`](apps/api/docs/ported-libs.md) and
[ADR-21](docs/adrs/21-monorepo-and-api-decoupling.md).

**2. Scope every query by organization.** This is a multi-tenant system and
cross-tenant leakage is the bug class we care most about. Never trust a
client-supplied `orgId` — derive it from the session. There is a warn-only
guard (`src/libs/db/tenant-scope-guard.ts`, [ADR-23](docs/adrs/23-tenant-scope-guard.md))
that logs when you forget, but it does not block the query — don't rely on it
instead of writing the `where` clause correctly.

**3. Don't hard-code user-facing strings.** The UI ships in fifteen languages —
see the `locales` list in `apps/web/src/app/config.ts` for the authoritative
set — via `next-intl`. Add the key, with its English text, to every file under
`src/app/messages/` (there is no key-parity check or automatic fallback yet, so
a locale missing a key renders the raw key string), then use `useT()` /
`getTranslations()`. Import `Link`, `redirect`, `usePathname` and `useRouter`
from `@/i18n/routing`, never from `next/link` or `next/navigation`.

## Tests

New code needs tests — see the table in [AGENTS.md](AGENTS.md#testing-requirements)
for what kind. Tests live next to the code in `__tests__/` directories.

Mock external services (Stripe, S3, Temporal, LLMs). Never hit a real backend
from a test.

## Commits and PRs

We use [Conventional Commits](https://www.conventionalcommits.org/) — commitlint
enforces this via a git hook, so a malformed message is rejected locally.

```
feat(chat): add message export
fix(rag): stop reranker from swallowing provider errors
docs: correct the embedding model in the README
```

In the PR description, say what changed and why, and what you ran to convince
yourself it works. Screenshots for UI changes. Link the issue with `Fixes #123`.

## Where to look things up

Match your task against the **Task Router** table at the top of
[AGENTS.md](AGENTS.md#task-router) — it maps areas of work to the ADR or doc that
explains them. Check [`docs/lessons.md`](docs/lessons.md) too: it catalogs
non-obvious gotchas people have already hit.

Architecture decisions live in [`docs/adrs/`](docs/adrs/). If you are changing
something an ADR covers, read it first; if you are making a decision worth
recording, add one.

## Licensing

Contributions are accepted under the [Apache License 2.0](LICENSE), the same
license that covers the project. By opening a pull request you confirm you have
the right to contribute the code and agree to license it under those terms.

Some directories are commercial and carry their own LICENSE file —
**we cannot accept external contributions to those**. See
[`docs/open-core-boundary.md`](docs/open-core-boundary.md) for which paths those
are and why. Everything else is open to contributions.
