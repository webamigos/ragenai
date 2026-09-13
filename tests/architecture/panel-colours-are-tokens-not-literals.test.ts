import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No file in `apps/web` or `packages` paints with a literal colour.
 *
 * The panel's colour rule is one line in `AGENTS.md` — use the semantic tokens,
 * never a literal Tailwind colour — and it took **five** passes to make true:
 * the shared primitives (#994), the knowledge base (#997), the rest of
 * `app/components` (#1000), `app/[locale]` (#1002), a re-ladder of the
 * surfaces the first three flattened (#1003), and finally white, black and the
 * hardcoded hex (#1004). Roughly 4,000 class names.
 *
 * A rule that expensive to apply should not be re-applicable. This is the
 * tripwire, and it exists because the sweep turned up defects a style guide
 * would never have caught:
 *
 * - A literal has no dark half unless someone writes one, so `bg-white` stayed
 *   white on a dark ground and a chat bubble glowed.
 * - Two shades of one ramp map to one token, so a selected tab became the
 *   colour of its own track and a hover stopped doing anything.
 * - White text was sitting on a pale tint at a contrast ratio of 1.09 — not
 *   low, invisible — because a literal cannot tell you what it contrasts with
 *   and a token can.
 *
 * Typecheck sees none of that. This test is the only thing that does.
 *
 * **Scope.** `apps/web/src` and `packages`, which is the panel and what it
 * shares. `apps/admin` is deliberately out: it is a separate surface under
 * ADR-35 and still carries ~96 literals, so including it would fail the build
 * today. Sweeping it is its own job; extend `ROOTS` when that happens.
 *
 * Comments are stripped before matching, so a file may describe the pattern it
 * must not contain — `Button.tsx` explains that `isError` replaced a
 * hand-rolled `bg-red-500 hover:bg-red-600`, and this doc block names half a
 * dozen literals itself.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..');

const ROOTS = [join('apps', 'web', 'src'), 'packages'];

/**
 * Mail clients do not resolve CSS custom properties. A token in an email is a
 * missing colour, so these templates are hex by necessity, not by neglect.
 */
const EXCLUDED_DIRS = [join('apps', 'web', 'src', 'app', 'emails') + sep];

/**
 * The literals that survive, each with the reason it is not a token.
 *
 * Keyed by file and by exact class: allowlisting a *file* would let it collect
 * new literals quietly, which is how an exception list stops meaning anything.
 * A stale entry fails the suite too — see the last test.
 *
 * The scrims were one smell rather than several: `bg-black/NN` declared
 * separately in file after file is an overlay component waiting to be written.
 * A scrim genuinely cannot be a token — it dims whatever sits behind it, so
 * `foreground/50` would turn it white in dark mode — but it should be declared
 * once. `components/ui/scrim.tsx` is now that component; the slide-over and the
 * chat's cited-source preview use it, and the modal and lightbox entries below
 * are the ones still to move.
 */
const ALLOWED: Array<{ file: string; classes: string[]; because: string }> = [
  {
    file: join(
      'apps/web/src/app/components/ManageKnowledge/DocumentDetail',
      'SuggestionDetailModal.tsx',
    ),
    classes: [
      'bg-red-50',
      'text-red-800',
      'bg-red-950',
      'text-red-200',
      'bg-green-50',
      'text-green-800',
      'bg-green-950',
      'text-green-200',
    ],
    because:
      'a before/after diff, not document state — mapping it onto ready/destructive would say "this went well" and "this failed" about two halves of a comparison',
  },
  {
    file: join(
      'apps/web/src/app/[locale]/(panel)/organization/chatbots/components',
      'ThemeConfigurator.tsx',
    ),
    classes: ['text-white'],
    because:
      "the avatar fallback sits on the customer's own primaryColor, injected through style — no token of ours knows what contrasts with it",
  },
  {
    file: join(
      'apps/web/src/app/components/Assistant/ChatOutput',
      'ChatOutput.tsx',
    ),
    classes: ['bg-black/80', 'bg-black/50', 'bg-black/70', 'text-white'],
    because: 'the lightbox scrim and the close button that sits on it',
  },
  {
    file: join(
      'apps/web/src/app/[locale]/(panel)/organization/security/components',
      'SecurityEventDetailDialog.tsx',
    ),
    classes: ['bg-black/50'],
    because: 'a modal scrim',
  },
  {
    file: join('apps/web/src/components/ui', 'scrim.tsx'),
    classes: ['bg-black/30', 'bg-black/40', 'bg-black/50'],
    because:
      "the overlay component this list has been asking for — the slide-over and the chat's cited-source preview both use it, and the modal and lightbox scrims below are worth moving here too",
  },
  {
    file: join('apps/web/src/components/ui', 'alert-dialog.tsx'),
    classes: ['bg-black/50'],
    because: 'a modal scrim',
  },
  {
    file: join('apps/web/src/components/ui', 'dialog.tsx'),
    classes: ['bg-black/50'],
    because: 'a modal scrim',
  },
  {
    file: join(
      'apps/web/src/libs/common-ui/SidebarLayout',
      'SidebarLayout.tsx',
    ),
    classes: ['bg-black/30'],
    because: 'the mobile sidebar scrim',
  },
];

const RAMPS = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');

const PROPERTIES = [
  'bg',
  'text',
  'border',
  'ring',
  'divide',
  'placeholder',
  'decoration',
  'outline',
  'shadow',
  'accent',
  'fill',
  'stroke',
  'caret',
  'from',
  'to',
  'via',
].join('|');

/**
 * A colour utility naming a value instead of a meaning: a Tailwind ramp step
 * (`bg-gray-100`), bare white or black (`dark:text-white`), or an arbitrary
 * hex (`bg-[#252d53]` — which was the brand navy, and had a token).
 *
 * Both spellings of the shade are written out. `-(?:50|[1-9]00|950)` looks
 * like it covers the ramp and does: 50, 100-900, 950. What it deliberately
 * does not match is `text-sm`, `gap-50` or `z-100`, which is why the property
 * prefix is required rather than matching the colour name alone.
 */
const LITERAL_COLOUR = new RegExp(
  `\\b(?:${PROPERTIES})-` +
    `(?:(?:${RAMPS})-(?:50|[1-9]00|950)` +
    `|white|black` +
    `|\\[#[0-9a-fA-F]{3,8}\\])` +
    // `(?![\w-])`, not `\b`. A word boundary needs a word character on one
    // side, and `bg-[#252d53]` ends in `]` — so the `\b` spelling matched
    // every ramp step and silently skipped every hex, which is the one thing
    // no reviewer would have thought to check. The self-test below caught it.
    `(?:/[\\d.]+)?(?![\\w-])`,
  'g',
);

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'generated',
  'coverage',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return SKIP_DIRS.has(entry) ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Strips comments without stripping code that merely contains `//`.
 *
 * The obvious `replace(/\/\/.*$/gm, '')` is a hole in a guard whose whole point
 * is that it cannot be walked around: `className="before:content-['//']
 * bg-red-500"` loses everything after the slashes, and the literal with it. A
 * `[^:]` guard for `https://` does not help — the character before the slashes
 * there is a quote, not a colon.
 *
 * So this tracks quoting. It is not a TypeScript parser and does not need to
 * be; it only has to decide, per line, whether a `//` sits inside a string.
 * Block comments go first, because one may legitimately describe a literal.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '\\') {
          i += 1;
        } else if (quote) {
          if (ch === quote) {
            quote = null;
          }
        } else if (ch === "'" || ch === '"' || ch === '`') {
          quote = ch;
        } else if (ch === '/' && line[i + 1] === '/') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

const files = ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
  .map((f) => relative(REPO_ROOT, f))
  .filter((path) => !EXCLUDED_DIRS.some((dir) => path.startsWith(dir)))
  .map((path) => ({
    path,
    code: stripComments(readFileSync(join(REPO_ROOT, path), 'utf8')),
  }));

const allowedFor = new Map(ALLOWED.map((e) => [e.file, new Set(e.classes)]));

function offendingClasses({
  path,
  code,
}: {
  path: string;
  code: string;
}): string[] {
  const allowed = allowedFor.get(path) ?? new Set<string>();
  return [...new Set(code.match(LITERAL_COLOUR) ?? [])].filter(
    (c) => !allowed.has(c),
  );
}

describe('panel colours', () => {
  it('finds source files to scan, so this cannot pass on an empty sweep', () => {
    expect(files.length).toBeGreaterThan(400);
  });

  it('are semantic tokens, never a literal Tailwind colour', () => {
    const offenders = files
      .map((file) => ({ path: file.path, classes: offendingClasses(file) }))
      .filter(({ classes }) => classes.length > 0);

    expect(
      offenders.map(({ path, classes }) => `${path}: ${classes.join(', ')}`),
      [
        'A literal colour is being painted instead of a token:',
        '',
        ...offenders.map(
          ({ path, classes }) => `  ${path}\n      ${classes.join(' ')}`,
        ),
        '',
        'Use the semantic tokens — bg-primary, text-muted-foreground,',
        'border-border, bg-card, text-destructive, text-ready, text-pending —',
        'or a ramp step (paper-*, brand-*, crimson-*) when you need a specific',
        'rung. See docs/panel-ux-rules.md.',
        '',
        'A literal has no dark half unless you write one, and nothing tells you',
        'what contrasts with it. That is how a chat bubble stayed white on a',
        'dark ground, a selected tab became the colour of its own track, and',
        'white text ended up on a pale tint at 1.09:1.',
        '',
        'If it genuinely cannot be a token — a scrim, a colour the customer',
        'chose — add it to ALLOWED in this file with the reason.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('has no stale entry in the exception list', () => {
    // An allowlist nobody prunes stops describing the code. If a file no
    // longer paints the literal it was excused for, the excuse goes too.
    const stale = ALLOWED.flatMap(({ file, classes }) => {
      const found = files.find((f) => f.path === file);
      if (!found) {
        return [`${file} (no longer exists, or is no longer scanned)`];
      }
      const present = new Set(found.code.match(LITERAL_COLOUR) ?? []);
      return classes
        .filter((c) => !present.has(c))
        .map((c) => `${file}: ${c} (no longer present)`);
    });

    expect(
      stale,
      `Remove these from ALLOWED:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('still matches the patterns it is meant to catch', () => {
    // Guards the regex. A refactor that broke it would leave this file green
    // while checking nothing — which is how the encryption guard was found to
    // be half-blind (it matched createDecipheriv and missed createCipheriv).
    const matches = (s: string) => new RegExp(LITERAL_COLOUR.source).test(s);

    expect(matches('bg-gray-100')).toBe(true);
    expect(matches('dark:text-zinc-400')).toBe(true);
    expect(matches('hover:bg-red-600')).toBe(true);
    expect(matches('dark:bg-amber-900/30')).toBe(true);
    expect(matches('text-white')).toBe(true);
    expect(matches('bg-black/50')).toBe(true);
    expect(matches('bg-[#252d53]')).toBe(true);
    expect(matches('data-[selected]:bg-white')).toBe(true);
    expect(matches('accent-blue-600')).toBe(true);
    expect(matches('divide-zinc-800')).toBe(true);

    // ...and does not catch what it must not. Every one of these is a real
    // class from the codebase; an over-eager regex would have failed the build
    // on the very tokens the sweep introduced.
    expect(matches('bg-primary')).toBe(false);
    expect(matches('text-muted-foreground')).toBe(false);
    expect(matches('dark:bg-card')).toBe(false);
    expect(matches('bg-paper-800')).toBe(false);
    expect(matches('bg-crimson-950/30')).toBe(false);
    expect(matches('text-brand-600')).toBe(false);
    expect(matches('bg-ready-tint')).toBe(false);
    expect(matches('text-pending-foreground')).toBe(false);
    expect(matches('text-sm')).toBe(false);
    expect(matches('gap-50')).toBe(false);
    expect(matches('z-100')).toBe(false);
    expect(matches('grid-cols-950')).toBe(false);
    expect(matches('min-w-[14px]')).toBe(false);
    // The word alone is not a colour class — `text-black-box-warning` is not,
    // and neither is a prop or a variable that happens to contain one.
    expect(matches('whitespace-nowrap')).toBe(false);
  });

  it('does not let a `//` inside a string hide the rest of the line', () => {
    // The bypass a line-comment regex leaves behind. Stripping from the first
    // `//` would drop `bg-red-500` here and the scan would report the file
    // clean — a guard you can walk around by writing a class with slashes in
    // it. Real Tailwind: `content-['//']` renders two slashes.
    const line = `const x = <div className="before:content-['//'] bg-red-500" />;`;

    expect(stripComments(line)).toContain('bg-red-500');
    // A fresh regex: `LITERAL_COLOUR` carries `g`, so `.test` on it is
    // stateful and would answer differently depending on test order.
    expect(new RegExp(LITERAL_COLOUR.source).test(stripComments(line))).toBe(
      true,
    );
  });

  it('still removes an actual line comment', () => {
    expect(stripComments('const a = 1; // bg-red-500 explained here')).toBe(
      'const a = 1; ',
    );
  });

  it('leaves a url alone, slashes and all', () => {
    // The `[^:]` guard the old spelling used was aimed at this case and only
    // this case; quote tracking covers it without a special rule.
    const line = `const u = 'https://example.com/a//b'; // bg-red-500`;

    expect(stripComments(line)).toBe(`const u = 'https://example.com/a//b'; `);
  });

  it('keeps a block comment out of the scan', () => {
    // Files here describe the very literals they must not contain, this one
    // included. Stripping block comments is what makes that possible.
    expect(stripComments('/* was bg-red-500 */ const a = 1;')).toBe(
      ' const a = 1;',
    );
  });
});
