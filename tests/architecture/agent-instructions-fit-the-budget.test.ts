import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every `AGENTS.md` has to stay under Codex's `project_doc_max_bytes`.
 *
 * The default is 32,768 bytes, and content past that offset is dropped
 * **silently** — no warning, no truncation notice, nothing in a diff. An agent
 * simply stops being told about whatever sits at the end of the file, and the
 * first sign is a rule being broken by something that never read it.
 *
 * `AGENTS.md` says so in its own header and asks the reader to check with
 * `wc -c`. Nobody does, and it reached 32,732 bytes — 36 bytes of headroom, so
 * a single new Task Router row would have crossed the line and taken the
 * Post-Task Workflow section with it. Hence a test rather than a note.
 *
 * The margin is deliberate. Failing at exactly the limit would let the file
 * creep back to 32,767 and then break on the next one-line addition, which is
 * the state this guard was written to end. A kibibyte of slack is enough to
 * notice and act: move long-form detail into `docs/` and leave a pointer,
 * which is what the header asks for and what keeps the hard rules intact.
 *
 * `CLAUDE.md` is a one-line import of `AGENTS.md` at each level, so it is
 * covered by whichever `AGENTS.md` it points at.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..');

/** Codex's default `project_doc_max_bytes`. Content past this never arrives. */
const HARD_LIMIT = 32_768;

/** Fail a kibibyte early, so there is room to split calmly. */
const BUDGET = HARD_LIMIT - 1_024;

const INSTRUCTION_FILES = [
  'AGENTS.md',
  'apps/api/AGENTS.md',
  'apps/worker/AGENTS.md',
  // Written and re-added by `next dev` on Next 16, not by hand — nine lines
  // warning that this Next differs from an agent's training data. Covered here
  // because this list is exhaustive by design, not because it is at any risk
  // of growing.
  'apps/web/AGENTS.md',
];

function sizeOf(relative: string): number {
  return readFileSync(join(REPO_ROOT, relative)).byteLength;
}

describe('agent instruction files fit the instruction budget', () => {
  it('finds every file it claims to cover, so a rename cannot pass vacuously', () => {
    const missing = INSTRUCTION_FILES.filter(
      (f) => !existsSync(join(REPO_ROOT, f)),
    );

    expect(missing).toEqual([]);
  });

  it.each(INSTRUCTION_FILES)('%s stays under the hard limit', (file) => {
    expect(sizeOf(file)).toBeLessThan(HARD_LIMIT);
  });

  it.each(INSTRUCTION_FILES)('%s keeps a working margin', (file) => {
    const size = sizeOf(file);

    expect(
      size,
      `${file} is ${size} bytes, over the ${BUDGET}-byte budget and ` +
        `${HARD_LIMIT - size} from the hard limit where Codex starts dropping ` +
        `content silently. Move long-form detail into docs/ and leave a ` +
        `pointer — do not trim the hard rules.`,
    ).toBeLessThanOrEqual(BUDGET);
  });

  it('covers every AGENTS.md in the repository, so a new one cannot be forgotten', () => {
    // A fourth workspace gaining its own brief must be added to the list
    // above, or it would grow past the limit unwatched.
    const known = new Set(INSTRUCTION_FILES);
    const candidates = [
      'AGENTS.md',
      'apps/web/AGENTS.md',
      'apps/api/AGENTS.md',
      'apps/admin/AGENTS.md',
      'apps/worker/AGENTS.md',
      'apps/docs/AGENTS.md',
      'apps/mcp/AGENTS.md',
    ];
    const unwatched = candidates.filter(
      (f) => existsSync(join(REPO_ROOT, f)) && !known.has(f),
    );

    expect(unwatched).toEqual([]);
  });
});
