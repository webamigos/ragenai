---
title: 'Five documents handed out the Postgres port the repo moved off, including the guide that warns about it — and a code comment had named two of them as wrong'
modules: ['web', 'api', 'worker', 'docs']
areas: ['architecture', 'documentation']
topics: ['postgres', 'redis', 'local-development', 'docker-compose', 'architecture-tests', 'documentation-drift']
---

# Five documents handed out the Postgres port the repo moved off, including the guide that warns about it

**Context**: `docker-compose.yml` publishes Postgres on host port **55432** and
Redis on **56379**, on purpose — a native Postgres on 5432 answers instead of
the container, and `prisma migrate` then works against the wrong database while
reporting success. `AGENTS.md` says so, `docs/lessons.md` says so, and
`create-ragen-app` writes 55432 into a fresh install's `.env.local`.

**Problem**: a review of an unrelated PR noticed that the E2E triage skill's
`prisma migrate deploy` and `prisma migrate reset` commands still said 5432 —
two sections above that same file's warning to "check ports, a native Postgres
on 5432 shadows the container". Following the thread found four more:
`apps/web/evals/e2e-rag/README.md` (three commands), the published
`self-hosting.md` (whose own installer generates 55432, so the doc contradicted
the tool it documents), and the `apps/api` and `apps/worker` env templates.
`apps/worker`'s also pointed Redis at 6379.

The last two were already _known_ wrong. `create-ragen-app`'s manifest carried a
comment — "docker-compose.yml maps Postgres to host port 55432, not the 5432
that both `.env.example` files show" — and worked around them by overwriting the
value. Whoever wrote that comment found the bug, described it precisely, and
left it in place. It had sat there ever since.

**Rule**: a rule that only lives in prose gets restated, not enforced. When you
find yourself writing a comment that names other files as wrong, fix those files
and add the guard instead —
`tests/architecture/docs-name-the-published-service-ports.test.ts` is the one
for this rule, and it fails on any Markdown or `.env.example` whose
`postgres://` or `redis://` connection string points at the shadowed port.

Keep such a guard on the surface that actually gets pasted into a terminal. The
first draft matched every `localhost:5432` anywhere and immediately failed on
ADR-21, which _explains_ this trap by describing the native Postgres holding
`127.0.0.1:5432` — correct prose that should not be reworded to satisfy a
regex. Requiring the URL scheme keeps the test on connection strings.

**Applies to**: any Markdown, README, skill or `.env.example` in this repository
that shows a host-side connection string; and more generally, any code comment
that documents a defect somewhere else rather than fixing it.
