---
title: 'A CI job that clones its own branch races the merge — the branch is deleted mid-run and the job fails on a pull request whose content is fine'
modules: ['ci', 'create-ragen-app']
areas: ['ci']
topics: ['github-actions', 'installer', 'giget', 'false-red', 'immutable-refs', 'architecture-tests']
---

# A CI job that clones a branch races the merge, and loses

**Context**: the `Installer` workflow's `Scaffold a fresh install` job is the
only check that exercises the first-run path. It cannot read the working tree
like every other job, because the thing under test *downloads* this repository
from GitHub — so it names the ref explicitly:

```yaml
env:
  BRANCH_REF: ${{ github.head_ref || github.ref_name }}
run: |
  create-ragen-app /tmp/ragen-smoke --ref="$BRANCH_REF" …
```

Without `--ref` the installer would scaffold from `main` and prove nothing
about the change under review, so naming the branch was the point.

**Problem**: the branch name is a moving label, and the job reads it later than
you think. On #1081 the pull request was merged at 18:06:36Z, GitHub's
auto-delete removed the head branch, and the job started at 18:06:48Z — twelve
seconds after the name it had been handed stopped existing. giget puts the ref
straight into GitHub's tarball endpoint, which answered accordingly:

```
Could not download feat/devcontainer-codespaces from the Ragen repository:
Failed to download https://api.github.com/repos/webamigos/RagenAI/tarball/feat/devcontainer-codespaces:
404 Not Found
```

The same endpoint returns 200 for `main` and for the commit SHA. So the failure
carried no information about the code it was meant to smoke-test: it reported
"the ref moved or vanished" in the shape of a red required check on a pull
request whose content was fine.

That is the inverse of the failures this catalogue mostly collects. A
[path glob that matches nothing](path-filters-fail-open-after-a-directory-move.md)
and [an `if: secret != ""` guard](a-secret-guarded-ci-step-fails-open.md) fail
*open* — green means nothing ran. This one fails *closed* — red means nothing
was wrong. Both break the same property: the check's colour stops being
evidence about the change.

And a re-run does not clear it. Re-running a job replays the *same* event
payload, so `github.head_ref` still expands to the branch that no longer
exists and the tarball 404s again. The red is permanent on that commit: the
branch would have to be restored, or the workflow fixed and a new commit
pushed — neither of which is available on a pull request that has already
merged.

**Rule**: a CI job that fetches this repository by name must name the
**commit**, never the branch:

```yaml
env:
  COMMIT_SHA: ${{ github.event.pull_request.head.sha || github.sha }}
```

`github.event.pull_request.head.sha` on a `pull_request` event, `github.sha` on
a push. A SHA cannot move, and GitHub keeps a pull request's head commit
reachable through `refs/pull/<n>/head` after the branch is deleted, so the
tarball still resolves once the pull request is merged. `github.head_ref` and
`github.ref_name` are both branch names and both carry this race.

Confirmed against the shipping resolver rather than assumed: giget 1.2.5 parses
`#<ref>` with `/^(?<repo>[\w.-]+\/[\w.-]+)(?<subdir>[^#]+)?(?<ref>#[\w./@-]+)?/`
and interpolates it unchanged into `/repos/<owner>/<repo>/tarball/<ref>`, so a
40-character SHA passes through and downloads that exact tree.

Guarded by `tests/architecture/ci-clones-a-commit-not-a-branch.test.ts`, which
reads the workflow and fails on a branch-name expression — the regression is
otherwise invisible until a merge happens to land inside a job's window, which
is rare enough to be forgotten and certain enough to recur.

**Applies to**: `.github/workflows/installer.yml` today. More generally, any
future job that resolves a ref over the network rather than reading the checked
out tree — release workflows that tag or publish from a ref, and anything
handing a ref to a tool that clones. `actions/checkout` is not affected: it
defaults to the SHA of the triggering event already.
