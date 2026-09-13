# create-ragen-app

Scaffolds a self-hosted [Ragen AI](https://github.com/webamigos/RagenAI)
installation with one command.

```bash
npx create-ragen-app my-ragen-app
```

It clones the repo, generates every secret it safely can, lets you paste a
plain OpenAI or Anthropic API key instead of configuring an enterprise model
provider, starts the backing services (Postgres, Qdrant, Temporal, LiteLLM,
Redis, …) in Docker, and runs the app's own first-run setup (Prisma client,
migrations, seed data). What is left is starting the two apps, in separate
terminals:

```bash
cd my-ragen-app
npm run api:dev   # apps/api — the web app creates threads through it
npm run web:dev   # apps/web — http://localhost:3000
```

`apps/api` is not optional: `apps/web` delegates thread creation, the thread
sidebar and notifications to it (ADR-21), so running only the web app gets you
a panel that loads and a chat that cannot open a thread.

## Node version

A Ragen installation needs Node 24, and the wizard refuses to create one on
anything older *before* it clones. Not because the CLI needs it — it does not,
and 0.2.0 was published and verified on Node 22 by accident — but because the
setup it runs for you (`npm install` across the monorepo, `prisma generate`,
`migrate deploy`, the seed) runs under the caller's Node and leaves a tree
that fails much later, nowhere near the cause. npm's `EBADENGINE` does warn,
as one line inside a wall of install output that does not say what breaks.

`--skip-install` turns the refusal into a warning, because then the wizard
runs nothing itself: scaffold here, run the setup on a supported Node. `--yes`
does not bypass it — that flag means "accept the defaults", not "ignore a
requirement".

## Keep this in sync with the app

This package is the only thing that exercises the first-run path.
`.github/workflows/installer.yml` runs it on pushes to `main` and on pull
requests from this repository: it packs the package, installs the tarball,
scaffolds from the commit under review and asserts the result is configured.
That catches a broken installer, but only for the cases the assertions cover —
`AGENTS.md`'s Post-Task Workflow still asks for an update here in the same PR,
and for the PR description to say so.

What counts as install-affecting:

| Change | What to update here |
| --- | --- |
| A new or renamed env var that a fresh install must set | `src/manifest.ts` (generated secret or corrected default) |
| A default model, embedding model or `VECTOR_SIZE` change | `src/llm-provider.ts` — and the two must stay consistent, or Qdrant rejects every upsert |
| An app the web app can no longer run without | the outro in `src/cli.ts`, which tells people what to start |
| A new first-run step (migration, seed, generate) | `src/tasks.ts` and `maybeRunFirstTimeSetup` |
| A `docker-compose.yml` service, port or name change | `src/tasks.ts`, and the collision check in `ragenStackVolumeExists` |
| A gate that a brand-new install cannot pass (registration, licensing, onboarding) | usually the app, not this package — a fresh install must be able to reach a working chat without an administrator who does not exist yet |

`tests/architecture/create-ragen-app-manifest-is-current.test.ts` catches one
direction only: a key this package writes that the `.env.example` no longer
has. The opposite drift — a new required var nobody taught the manifest
about — has no textual signal, which is why the rule above is a rule.

## Flags

| Flag              | Effect                                             |
| ----------------- | --------------------------------------------------- |
| `--ref=<ref>`     | Clone a branch, tag or commit SHA other than `main`   |
| `--skip-docker`   | Write the `.env.local` files but don't start Docker  |
| `--skip-install`  | Skip `npm install` / Prisma / seed                   |
| `--yes`           | Accept every default without prompting               |
| `--provider=openai\|anthropic` | Take the API key from `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` instead of prompting |

Anything the wizard doesn't ask about (S3 storage, encryption at rest,
Stripe, email, MCP connectors) ships exactly as documented in the repo's own
`.env.example` files — see
[docs/self-hosting](https://docs.ragen.ai/docs/self-hosting).

## Declining to paste a key

Typing a provider API key into someone else's CLI is a reasonable thing to
refuse, so the provider step is skippable — pick *"I'll configure LiteLLM
myself"*, or press enter on an empty key. The install still completes, and
`SETUP-LLM.md` is written into the new directory with the exact `.env.local`
values and `model_list` entries for OpenAI and Anthropic, plus the one
ordering constraint that matters (`VECTOR_SIZE` has to be right *before* the
first document is indexed). `src/manual-setup.ts` generates that file from
`LLM_PROVIDERS`, so it cannot drift from what the wizard would have done.

## What it changes, and how it decides

`src/manifest.ts` is the single list of which env vars get a generated
secret or a corrected local-dev default, and which files receive them. It is
deliberately an *overrides* list — anything not in it is left exactly as the
cloned repo's own `.env.example` already has it. See the file's own comments
for the sharing rules (some secrets are the same value in two files, most are
independent).

## Testing a change before publishing

`npm pack` reproduces exactly what npm would serve — it honours `files`,
`bin` and `prepare` — so the published artifact can be exercised without a
registry:

```bash
pack=$(mktemp -d)
npm pack --workspace=create-ragen-app --pack-destination="$pack"
npm install --prefix "$pack" "$pack"/create-ragen-app-*.tgz
"$pack"/node_modules/.bin/create-ragen-app /tmp/try-ragen \
  --ref=my-branch --provider=openai --skip-docker --skip-install
```

Three details, each of which this file previously got wrong:

- **Install the tarball, do not hand it to `npx`.** `npx ./thing.tgz` does not
  install and run a local package — it tries to *execute* the file, and fails
  with `Permission denied`. `.github/workflows/installer.yml` installs it,
  which is why CI passed while the command written here never ran.
- **Glob the filename.** `npm pack` names the tarball after the version in
  `package.json`, so writing one here goes stale at the next release.
- **Pack into an empty directory.** That is what keeps the glob honest: a
  shared `/tmp` accumulates one tarball per version ever built, the glob then
  expands to several paths, and `npm install` would be handed all of them.

`--ref` is the part people forget: the CLI clones the repository from GitHub,
so testing a change to the *app* needs that branch pushed. Without it you are
testing new installer code against old repository content.

It takes anything GitHub's tarball endpoint resolves — a branch, a tag, or a
full commit SHA. The `Installer` workflow passes the **commit**, because a
branch can be deleted by the merge while the job is still running and the
endpoint then 404s on a name that resolved seconds earlier. Prefer a SHA
anywhere the ref is chosen by a machine rather than typed by hand. See
[the lesson](../../docs/lessons/a-ci-job-that-clones-a-branch-races-the-merge.md).

`prepare` runs `clean` before `build` deliberately. `files` publishes `dist`
wholesale and `tsc` does not remove the output of a source file that no
longer exists, so without the clean a renamed or deleted module ships as a
stale `.js` that nothing in the repo can explain.

## Publishing (manual for now)

There is no publish job in CI (see the project plan's non-goals), so this is a
checklist rather than one command:

```bash
npm version <patch|minor|major> --workspace=create-ragen-app
npm install --package-lock-only
git add packages/create-ragen-app/package.json package-lock.json
git commit -m "chore(release): create-ragen-app <version>"
```

**Land that on `main` before publishing.** `main` is protected, so it goes
through a pull request like anything else — and publishing first is precisely
how the registry ended up ahead of the repository last time. npm versions are
immutable: once `0.2.0` exists, a repository that still says `0.1.0` cannot be
corrected by re-publishing, only by pushing the commit that should have gone
first.

```bash
git checkout main && git pull
npm publish --workspace=create-ragen-app
```

Publishing from a merged `main` also means the tarball is built from the tree
everyone else can see, rather than from whatever happens to be in the working
directory.

The two middle lines of the first block are there because of what `npm
version` does *not* do for a workspace. Both have already cost this package a
release:

- **It does not commit, and does not tag.** In a single-package repository it
  does both; with `--workspace` it rewrites `package.json` and leaves the
  change unstaged, printing only the new version. 0.2.0 went to npm from a
  bump that then sat uncommitted on a laptop, so the registry served 0.2.0
  while `main` still said 0.1.0 — and `npm publish` from `main` would have
  been rejected as an existing version.
- **It does not touch `package-lock.json`.** The lockfile keeps its own copy
  of every workspace's version, so it stayed on `0.1.0`. That is why
  `git add package-lock.json` staged nothing in that release commit: there was
  nothing to stage. `npm install --package-lock-only` fixes it and leaves
  `node_modules` alone.

`npm run build` is deliberately absent: `prepare` already runs `clean &&
build` on publish, and it has to clean — `files` publishes `dist` wholesale
and `tsc` does not remove the output of a source file that no longer exists.

Then exercise what was actually published, not just what was packed — from
the repository root:

```bash
OPENAI_API_KEY=dummy npx create-ragen-app@latest /tmp/verify-release \
  --provider=openai --skip-docker --skip-install
node scripts/ci/assert-scaffolded-install.mjs /tmp/verify-release
```
