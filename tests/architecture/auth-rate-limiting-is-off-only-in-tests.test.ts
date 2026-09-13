import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Better Auth's rate limiter is off for `TARGET_ENV=test` and on everywhere
 * else — and the gate is that variable, not `NODE_ENV`.
 *
 * Better Auth enables its own limiter whenever `NODE_ENV === 'production'`, at
 * 100 requests per 10 seconds per IP. The E2E suite meets both halves of that:
 * it drives a production build rather than the dev server, and it is one IP
 * making requests as fast as Playwright can issue them, with at least one
 * `/api/auth/get-session` per authenticated page load. Somewhere past the
 * hundredth in a window the endpoint answers 429, the client reads that as
 * "not signed in", and `PanelLayoutWrapper` sends the page to /sign-in.
 *
 * It does not fail as a rate-limit error anywhere a reader would look. It
 * fails as a three-or-four-test hole that moves depending on how the run is
 * paced, with each failure showing the sign-in page while the session row is
 * alive in the database and the test either side of it passes on the same
 * route. On `main` that was `p1-31 › members tab shows current user as owner`,
 * red in four consecutive CI runs and read as an auth regression.
 *
 * Two ways this could regress, and the two assertions below:
 *
 * 1. The `rateLimit` block is deleted, and the intermittent failures come
 *    back — for a reason nobody will connect to auth configuration.
 * 2. The gate is widened to `NODE_ENV !== 'production'` or `!isProduction`,
 *    which would also disable the limiter for every development and preview
 *    deployment. The limiter exists to make credential stuffing expensive; a
 *    test environment has no credentials worth stuffing, a preview deployment
 *    may well have.
 */

const AUTH_FILE = join(
  import.meta.dirname,
  '..',
  '..',
  'apps',
  'web',
  'src',
  'lib',
  'auth.ts',
);

function authSource(): string {
  return readFileSync(AUTH_FILE, 'utf8');
}

describe('Better Auth rate limiting', () => {
  it('is configured explicitly rather than left to Better Auth’s default', () => {
    // The default is "on in production", which is what the E2E suite runs.
    expect(authSource()).toMatch(/rateLimit:\s*\{/);
  });

  it('is disabled for TARGET_ENV=test and nothing else', () => {
    const source = authSource();
    const block = source.slice(source.indexOf('rateLimit: {'));

    expect(block).toMatch(/enabled:\s*!isTestTargetEnv/);
    expect(source).toContain(
      "import { isTestTargetEnv } from '@/libs/utils/env'",
    );
  });

  it('does not key the switch on NODE_ENV', () => {
    const source = authSource();
    const start = source.indexOf('rateLimit: {');
    const block = source.slice(start, source.indexOf('}', start));

    // `isProduction`/`NODE_ENV` here would take the limiter off every
    // development and preview deployment too, not just the test suite.
    expect(block).not.toMatch(/NODE_ENV|isProduction|isDevelopment/);
  });
});
