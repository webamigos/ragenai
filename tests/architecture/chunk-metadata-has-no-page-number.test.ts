import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nothing writes `page_number` into chunk metadata.
 *
 * The field existed, held `index + 1`, and the design labelled it "page {n}" —
 * so a twelve-page PDF split into forty chunks reported "page 37". Gap 3 of
 * `docs/specs/2026-09-09-design-system-v2-functional-gaps.md` split it in two:
 * `chunk_index` for the ordinal it always was, and `source_page` for a real
 * page, written only when the parser knows one.
 *
 * This guards the half that is easy to undo. Re-adding `page_number` is a
 * one-word change that typechecks, passes every unit test, and puts an ordinal
 * back under a name that invites the old bug — and it cannot be caught by
 * reading a diff, because the two writers live in different apps.
 *
 * It also holds the type to one home. The payload shape used to be declared in
 * two places and they drifted eleven fields apart before ADR-33's answer —
 * move the shared thing into a package — was applied here.
 *
 * Old chunks in Qdrant still carry the field. That is deliberate: nothing
 * reads it, a re-index is what upgrades a document, and `source_page`'s
 * absence on those chunks is what makes them safe rather than mislabelled.
 */
const ROOT = join(import.meta.dirname, '..', '..');

/**
 * Everything that names a field in the chunk payload.
 *
 * `vector-metadata.ts` replaced the two hand-kept type copies that used to be
 * in this list: the canonical shape moved into `@ragenai/rag-core` (ADR-33)
 * and the former homes became re-exports, which is what {@link RE_EXPORTS}
 * below holds them to.
 */
const WRITERS = [
  'apps/worker/src/activities/embeddings/prepare-metadata.ts',
  'apps/web/src/app/api/threads/services/saveDataInVectorTable.ts',
  'packages/rag-core/src/vector-metadata.ts',
];

/**
 * The two paths that used to declare their own copy of the payload type.
 *
 * They drifted eleven fields apart while both were live, which is why the type
 * moved into a package. These are kept as re-exports so the move landed
 * without import churn — and asserted to *stay* re-exports, because the cheap
 * way to add a field to one app is to start declaring the type locally again,
 * and that is precisely how the drift began.
 */
const RE_EXPORTS = [
  'apps/worker/src/services/llm/types/vector-store.ts',
  'apps/web/src/app/lib/types/types.ts',
];

/** Strips block and line comments so prose about the old name does not count. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('chunk metadata', () => {
  it.each(WRITERS)('%s does not write page_number', (relative) => {
    const code = stripComments(readFileSync(join(ROOT, relative), 'utf8'));

    expect(code).not.toMatch(/\bpage_number\b/);
  });

  it.each(WRITERS)('%s carries chunk_index instead', (relative) => {
    const code = stripComments(readFileSync(join(ROOT, relative), 'utf8'));

    expect(code).toMatch(/\bchunk_index\b/);
  });

  it.each(RE_EXPORTS)(
    '%s does not declare the payload type again',
    (relative) => {
      const code = stripComments(readFileSync(join(ROOT, relative), 'utf8'));

      // The *type* has to come from the package, not merely something. A file
      // that imports a constant from `@ragenai/rag-core` and then declares its
      // own `VectorStoreDocumentMetadata` satisfied a bare "imports from
      // rag-core" check — which is the drift this whole file exists to stop.
      expect(code).toMatch(
        /export\s*\{[^}]*\bVectorStoreDocumentMetadata\b[^}]*\}\s*from\s*'@ragenai\/rag-core'/s,
      );

      // Both spellings of a local declaration. The alias was checked; the
      // interface was not, and `interface VectorStoreDocumentMetadata {` is
      // the more natural thing to write.
      expect(code).not.toMatch(
        /(?:^|\n)\s*(?:export\s+)?type\s+VectorStoreDocumentMetadata\s*=/,
      );
      expect(code).not.toMatch(
        /(?:^|\n)\s*(?:export\s+)?interface\s+VectorStoreDocumentMetadata\b/,
      );
    },
  );

  it.each(RE_EXPORTS)('%s does not write page_number either', (relative) => {
    const code = stripComments(readFileSync(join(ROOT, relative), 'utf8'));

    expect(code).not.toMatch(/\bpage_number\b/);
  });
});
