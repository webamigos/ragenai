import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';

/**
 * No document hands out a connection string on `localhost:5432` or `:6379`.
 *
 * `docker-compose.yml` publishes Postgres on **55432** and Redis on **56379**,
 * deliberately: a native Postgres on 5432 answers instead of the container, and
 * `prisma migrate` then talks to the wrong database *while reporting success*.
 * That has cost real time twice, and the failure never looks like a port — it
 * looks like a schema that will not apply, or a seed that vanished.
 *
 * Which makes a copy-pasteable command the worst place for the wrong port, and
 * that is exactly where they kept appearing. When this test was written five
 * files were handing out 5432: the E2E triage skill's own migrate and reset
 * commands — two sections above its warning about this very trap — the e2e-rag
 * eval README, the published self-hosting guide (whose installer generates
 * 55432, so the doc contradicted the tool it documents), and the `apps/api` and
 * `apps/worker` env templates. `create-ragen-app`'s manifest had a comment
 * naming the last two as wrong; nobody fixed them, because a comment cannot
 * fail a build.
 *
 * **It matches connection strings, not every mention of a number.** The first
 * draft matched any `localhost:5432` and caught ADR-21, which explains this
 * trap by describing the native Postgres holding `127.0.0.1:5432` — prose that
 * is correct and should not be rewritten to satisfy a regex. Requiring the
 * `postgres://` or `redis://` scheme keeps the rule on the thing that gets
 * pasted into a terminal. A doc that writes the port out longhand (`psql -h
 * localhost -p 5432`) slips through; none did, and widening the net far enough
 * to catch that hypothetical is what broke on the real prose.
 *
 * Scope is the copy-paste surface — Markdown and `.env.example` — not source.
 * Unit tests use `postgresql://localhost:5432/db` as a throwaway string and
 * should keep doing so; nobody pastes a fixture into a terminal. A service
 * inside the compose network also still reaches its peers on the standard port
 * (`litellm-postgres:5432`), which is why this matches the host spellings only.
 */
const REPO_ROOT = join(import.meta.dirname, '..', '..');

/** Directory names never worth walking: build output, dependencies, checkouts. */
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  'dist',
  'build',
  'out',
  'coverage',
  'generated',
  'test-results',
  'playwright-report',
  'worktrees',
]);

/** The host port each in-container port is published on. */
const PUBLISHED: Record<string, string> = {
  '5432': '55432',
  '6379': '56379',
};

/**
 * Files exempt from the rule.
 *
 * Empty, and it should stay that way: a document describing a database this
 * repository does not run names a host, not `localhost`. Add a path here only
 * with a comment saying which server is being reached and why it is on the
 * standard port.
 */
const ALLOWED: string[] = [];

const SHADOWED =
  /(?:postgres(?:ql)?|redis|rediss):\/\/[^\s"'`]*?(?:localhost|127\.0\.0\.1):(5432|6379)\b/;

function copyPasteSurfaces(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) {
        copyPasteSurfaces(path, found);
      }
    } else if (
      entry.name.endsWith('.md') ||
      basename(path) === '.env.example'
    ) {
      found.push(path);
    }
  }
  return found;
}

describe('documents name the published service ports', () => {
  const files = copyPasteSurfaces(REPO_ROOT).filter(
    (path) => !ALLOWED.includes(path.slice(REPO_ROOT.length + 1)),
  );

  it('finds the documents to check', () => {
    // A broken walk would pass every assertion below by checking nothing.
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((path) => path.slice(REPO_ROOT.length + 1)))(
    '%s does not send a reader to a shadowed port',
    (relative) => {
      const offenders = readFileSync(join(REPO_ROOT, relative), 'utf8')
        .split('\n')
        .flatMap((line, index) => {
          const shadowed = SHADOWED.exec(line);
          if (!shadowed) {
            return [];
          }
          const port = shadowed[1];
          return [
            `${relative}:${index + 1} connects on ${port}, but ` +
              `docker-compose.yml publishes that service on ${PUBLISHED[port]} ` +
              `— ${line.trim()}`,
          ];
        });

      expect(offenders).toEqual([]);
    },
  );
});
