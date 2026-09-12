---
title: A `webpack` block in next.config.ts does nothing under Turbopack, and Next says nothing about it
modules: [web, admin]
areas: [architecture, dependencies]
topics: [nextjs, turbopack, webpack, bundler, dead-config, fail-open, pdfjs]
---

## Context

Element-level provenance needed the react-pdf viewer in
`apps/web/src/app/components/ManageKnowledge/DocumentPreview/viewers/PdfViewer.tsx`
to work. The spec's Phase B opened by proving it did rather than assuming,
because that component had no test and the `pdfjs-dist` alias meant to support
it looked wrong:

```ts
// apps/web/next.config.ts
webpack: (config, { isServer, webpack }) => {
  config.resolve.alias['pdfjs-dist'] = require('path').resolve(__dirname, 'node_modules/pdfjs-dist/legacy/build/pdf.js');
  // …plus a serverLogger → clientLogger NormalModuleReplacementPlugin,
  //    node: protocol replacements, and client-side fallbacks
};
```

## Problem

The alias pointed at a file that does not exist, for two independent reasons:
`pdfjs-dist` is hoisted to the monorepo root, so
`apps/web/node_modules/pdfjs-dist` is not where it lives; and
`pdfjs-dist@5.4.296` ships only `.mjs`, so there is no `pdf.js` in `build/` or
`legacy/build/`.

It had no effect either way, which is the part worth writing down. **`apps/web`
runs bare `next dev` / `next build` on Next 16, where Turbopack is the bundler,
and a `webpack` key is never called.** The build banner says
`▲ Next.js 16.3.4 (Turbopack)`; there is no warning that a webpack config is
present and ignored, and the build is green.

So an entire config block sat in the repo reading as live behaviour — AGENTS.md
even documented one part of it as fact ("webpack swaps server → client logger on
client builds") — while doing nothing. The viewer worked regardless, because
Turbopack resolves `pdfjs-dist` normally and handles
`new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` by emitting
the worker to `.next/static/media/` and referencing that URL from the client
chunk.

The cost of the broken alias is not today; it is the first person who runs
`next build --webpack` to debug something else and gets an unresolvable module
in a file they did not touch.

**Auditing the rest of the block turned up nothing that was needed, and one
thing that would have been harmful.** Measured against a real build:

| What it configured                             | Verdict                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverLogger` → `clientLogger` swap           | Unnecessary. `logger/index.ts` picks at _runtime_ on `typeof window`; no client chunk contains pino-pretty or serverLogger's own throw message. |
| `generated/prisma/client` → `browser` redirect | Unnecessary. Client components already import `@/generated/prisma/browser` — 53 files do.                                                       |
| `externals: ['better-auth', …]`                | **Would have broken the app.** 62 client entry points use `better-auth/react`. It was only harmless because it never ran.                       |
| `resolve.fallback` for a dozen node builtins   | Unnecessary. No `node:` builtin appears in any client chunk.                                                                                    |

The last one is the interesting case. Under webpack, `module: false` let the
_server_ Prisma entry be bundled to the browser with its `node:module` import
stubbed out — so the config was, in effect, permission to ship something that
should never have been in a client bundle. Turbopack has no such escape hatch:
a client component importing `@/generated/prisma/client` fails the build. It
just fails it like this:

```
FATAL: An unexpected Turbopack error occurred. A panic log has been written
to /var/folders/…/next-panic-<hash>.log
- the chunking context (unknown) does not support external modules
  (request: node:module)
```

No file, no import, no rule.

## Rule

**On Next 15+, check which bundler actually runs before reading a `webpack`
block as behaviour.** The banner line of a build says which one. A `webpack`
key is silently inert under Turbopack — nothing warns, nothing fails.

Three corollaries:

- Do not "fix" a broken entry in an inert block. Decide whether the thing it
  configures is still needed: port it to `turbopack.resolveAlias`, or delete it
  and correct whatever documentation claims it is live. A block that reads as
  live and does nothing is worse than either.
- Proving a bundler behaviour needs the build output, not the config. `grep` the
  emitted chunks under `.next/static` for the asset or the module you expect —
  that is what settled whether pdf.js was wired up here, and what settled every
  row of the table above. No unit test could have.
- When tracing what reaches a client bundle, **stop at `'use server'`**. Next
  replaces such an import with an RPC stub, so nothing behind it is bundled.
  Walking through one reports every server action that touches Prisma as a
  leak — 43 of them here — and a guard that noisy gets deleted rather than
  fixed.

## Applies to

`apps/web` and `apps/admin`, and any Next app in this monorepo that still
carries a `webpack` function.

`apps/web`'s block is gone in full, and two claims in `AGENTS.md` that
described it as live behaviour are corrected.
`tests/architecture/client-bundles-stay-browser-safe.test.ts` now enforces what
the block pretended to arrange — nothing server-only reachable from a
`'use client'` file — and fails the `webpack` key back in, because re-adding
one is a silent no-op.
