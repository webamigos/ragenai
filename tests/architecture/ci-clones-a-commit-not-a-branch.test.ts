import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The installer smoke job scaffolds a fresh install from this repository over
 * the network, so it has to name a ref — and that ref must be the commit, not
 * the branch it happens to sit on.
 *
 * A branch name is a moving label. Merging a pull request with auto-delete on
 * removes the head branch, and `/repos/<owner>/<repo>/tarball/<branch>` then
 * answers 404 for a name that resolved seconds earlier. The job fails against
 * a pull request whose content is fine, which is the fail-shape this
 * repository keeps a catalogue about: the check's colour stops being evidence
 * about the change. `github.event.pull_request.head.sha` (and `github.sha` on
 * a push) cannot move, and GitHub keeps a pull request's head commit
 * reachable through `refs/pull/<n>/head` even after the branch is gone.
 *
 * A guard rather than a comment because the regression is invisible until a
 * merge happens to land inside the job's window — the same run passes on
 * every re-run afterwards.
 *
 * See docs/lessons/a-ci-job-that-clones-a-branch-races-the-merge.md.
 */
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

const INSTALLER_WORKFLOW = '.github/workflows/installer.yml';

const workflow = readFileSync(join(repoRoot, INSTALLER_WORKFLOW), 'utf8');

/** The environment variable `--ref=` reads, e.g. `COMMIT_SHA`. */
const refVariable = workflow.match(/--ref="\$([A-Za-z_][A-Za-z0-9_]*)"/)?.[1];

/**
 * What that variable is assigned in the step's `env:` block. Resolved through
 * the name rather than matched independently, so the assertions below cannot
 * be satisfied by a commit SHA that some *other* variable holds while `--ref`
 * still reads a branch.
 */
const refAssignment = refVariable
  ? workflow.match(
      new RegExp(`^\\s*${refVariable}:\\s*\\$\\{\\{([^}]*)\\}\\}`, 'm'),
    )?.[1]
  : undefined;

/**
 * The `||` operands of that expression, in order. Compared as a whole list
 * rather than searched for substrings: `head.sha || github.sha || github.ref`
 * contains both SHAs and still falls back to a branch ref, and reversing the
 * two puts `github.sha` first — which on a `pull_request` event is the *merge*
 * commit, a different tree from the one under review.
 */
const refOperands = refAssignment
  ?.split('||')
  .map((operand) => operand.trim())
  .filter(Boolean);

describe(`${INSTALLER_WORKFLOW} scaffolds from a commit, not a branch`, () => {
  it('passes --ref from an environment variable rather than inline', () => {
    // Belt and braces on the injection guard the step already documents: a
    // ref interpolated into the script body would run as shell.
    expect(refVariable).toBeDefined();
    expect(workflow).not.toMatch(/--ref="?\$\{\{/);
  });

  it('names the head commit on a pull request and the pushed commit otherwise', () => {
    // Exactly these two, in this order. Every other context that could sit
    // here is either a branch name or the wrong commit.
    expect(refOperands).toEqual([
      'github.event.pull_request.head.sha',
      'github.sha',
    ]);
  });

  it('never resolves the ref from a branch name', () => {
    // `github.head_ref` and `github.ref_name` are both branch names, and both
    // vanish when the merge deletes the branch mid-run.
    expect(workflow).not.toMatch(/github\.head_ref|github\.ref_name/);
  });
});
