import { downloadTemplate } from 'giget';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RAGEN_APP_REPO, cloneRagenApp } from '../clone';

vi.mock('giget', () => ({
  downloadTemplate: vi.fn().mockResolvedValue({ dir: '/tmp/ragen' }),
}));

const mocked = vi.mocked(downloadTemplate);

const sourceOf = (): string => String(mocked.mock.calls[0]?.[0]);

describe('cloneRagenApp', () => {
  beforeEach(() => {
    mocked.mockClear();
  });

  it('asks giget for the ref as a fragment on the Ragen repository', async () => {
    await cloneRagenApp('/tmp/ragen', 'main');

    expect(sourceOf()).toBe(`github:${RAGEN_APP_REPO}#main`);
    expect(mocked.mock.calls[0]?.[1]).toMatchObject({
      dir: '/tmp/ragen',
      install: false,
    });
  });

  it('passes a full commit SHA through untouched', async () => {
    // CI scaffolds from `github.event.pull_request.head.sha`, not from the
    // branch name — a branch is deleted on merge and the tarball endpoint
    // then 404s mid-run, failing a pull request whose content is fine. giget
    // puts this straight into `/repos/<owner>/<repo>/tarball/<ref>`, which
    // resolves a SHA, so nothing here may abbreviate or rewrite it.
    // See docs/lessons/a-ci-job-that-clones-a-branch-races-the-merge.md.
    const sha = 'f35087e92600d4e1f8de7e9b149fac27d8be0007';

    await cloneRagenApp('/tmp/ragen', sha);

    expect(sourceOf()).toBe(`github:${RAGEN_APP_REPO}#${sha}`);
  });

  it('passes a tag through untouched, so a release can be installed by name', async () => {
    await cloneRagenApp('/tmp/ragen', 'v1.2.0');

    expect(sourceOf()).toBe(`github:${RAGEN_APP_REPO}#v1.2.0`);
  });

  it('never cleans the target directory, which the CLI has already vetted', async () => {
    await cloneRagenApp('/tmp/ragen', 'main');

    expect(mocked.mock.calls[0]?.[1]).toMatchObject({ forceClean: false });
  });
});
