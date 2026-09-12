import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Nothing a client component can reach is server-only.
 *
 * `apps/web` used to configure this in a `webpack` block — a
 * `NormalModuleReplacementPlugin` redirecting `generated/prisma/client` to
 * `generated/prisma/browser`, another swapping `serverLogger` for
 * `clientLogger`, and `resolve.fallback` stubs so node builtins resolved to
 * nothing in the browser. **None of it ever ran.** The app builds with bare
 * `next build` on Next 16, where Turbopack is the bundler and a `webpack` key
 * is never invoked. See
 * `docs/lessons/a-webpack-config-block-is-inert-under-turbopack.md`.
 *
 * Removing dead config does not create a risk here, because Turbopack has no
 * `resolve.fallback` escape hatch: a client component importing
 * `@/generated/prisma/client` **fails the build**. What it does not do is say
 * so usefully. The whole message is:
 *
 *     FATAL: An unexpected Turbopack error occurred. A panic log has been
 *     written to /var/folders/…/next-panic-<hash>.log
 *     - the chunking context (unknown) does not support external modules
 *       (request: node:module)
 *
 * No file, no import, no rule — a panic report inviting you to file a bug
 * against Next. This test exists to name the file and the rule instead, and it
 * runs in seconds rather than after a four-minute build.
 *
 * **How reachability is decided.** From every `'use client'` file, follow
 * *value* imports (`import type` and `import { type X }` are erased before
 * bundling) and stop at any `'use server'` module: Next replaces those with an
 * RPC stub, so nothing behind one reaches the browser. Walking through a server
 * action is the mistake that makes this look alarming — it reports 43 "leaks"
 * that are all server actions doing their job.
 *
 * **Its limits, stated rather than discovered.** Imports are matched with a
 * regular expression, so a dynamic `import(someVariable)` or a `require()`
 * built from a template is invisible to it. That is the same trade every test
 * in this directory makes — they read source as text — and it is why this
 * guards the named, common mistake rather than claiming to prove an absence.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const WEB_SRC = join(REPO_ROOT, 'apps', 'web', 'src');

/**
 * Modules that must never be reachable from the browser, and why.
 *
 * Matched as substrings of the import specifier, so `@/generated/prisma/client`
 * and a relative path ending in the same thing both count.
 */
const SERVER_ONLY: Array<{ specifier: string; because: string }> = [
  {
    specifier: '@/generated/prisma/client',
    because:
      "it imports node:process, node:path, node:url and Prisma's server runtime. " +
      'Client components import `@/generated/prisma/browser` instead — 53 of ' +
      'them do — which is the entry Prisma generates for exactly this.',
  },
  {
    specifier: 'app/lib/utils/logger/serverLogger',
    because:
      'it requires pino-pretty and throws on import when `window` is defined. ' +
      'Import `@/app/lib/utils/logger`, which picks the right one at runtime.',
  },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!/(__tests__|__mocks__|generated)$/.test(entry)) {
        out.push(...sourceFiles(path));
      }
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

const read = (file: string): string => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const hasDirective = (source: string, directive: string): boolean =>
  new RegExp(`^\\s*(['"])${directive}\\1`).test(source);

/**
 * Import specifiers whose module is actually evaluated in the bundle.
 *
 * `import type { X } from './y'` and `import { type X } from './y'` are erased
 * by the compiler and cannot pull anything into a chunk, so counting them would
 * flag every component that types a prop with a Prisma enum.
 */
function valueImports(source: string): string[] {
  const specifiers: string[] = [];

  for (const match of source.matchAll(
    /import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    const [, typeKeyword, clause, specifier] = match;
    if (typeKeyword) {
      continue;
    }
    // `import { type A, type B } from 'x'` is also fully erased. A default or
    // namespace binding outside the braces means something is evaluated.
    const outsideBraces = clause.replace(/\{[\s\S]*\}/, '').trim();
    const named = /\{([\s\S]*)\}/.exec(clause)?.[1] ?? '';
    const hasValueBinding =
      outsideBraces.length > 0 ||
      named
        .split(',')
        .some((part) => part.trim().length > 0 && !/^type\s/.test(part.trim()));
    if (hasValueBinding || named.trim().length === 0) {
      specifiers.push(specifier);
    }
  }

  // Side-effect imports and re-exports evaluate the module too.
  for (const match of source.matchAll(
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  )) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(
    /export\s+(?:\*|\{[\s\S]*?\})\s+from\s*['"]([^'"]+)['"]/g,
  )) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

function resolveSpecifier(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) {
    base = join(WEB_SRC, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    // A bare package specifier. Nothing in SERVER_ONLY is one, and following
    // node_modules would make this a bundler rather than a test.
    return null;
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/** The import chain from a client entry point to a forbidden module, if any. */
function pathToServerOnly(entry: string, specifier: string): string[] | null {
  const seen = new Set<string>();
  const stack: Array<{ file: string; trail: string[] }> = [
    { file: entry, trail: [entry] },
  ];

  while (stack.length > 0) {
    const { file, trail } = stack.pop()!;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);

    const source = read(file);
    // Next replaces a `'use server'` import with an RPC stub, so the module and
    // everything it imports stay on the server.
    if (file !== entry && hasDirective(source, 'use server')) {
      continue;
    }

    for (const imported of valueImports(source)) {
      if (imported.includes(specifier)) {
        return [...trail, imported];
      }
      const next = resolveSpecifier(imported, file);
      if (next !== null && !seen.has(next)) {
        stack.push({ file: next, trail: [...trail, next] });
      }
    }
  }

  return null;
}

const allFiles = sourceFiles(WEB_SRC);
const clientEntryPoints = allFiles.filter((file) =>
  hasDirective(read(file), 'use client'),
);

describe('client bundles stay browser-safe', () => {
  it('finds the client components it claims to check', () => {
    // Without this, a change to how the directive is written would make every
    // assertion below pass over an empty list.
    expect(clientEntryPoints.length).toBeGreaterThan(100);
  });

  it.each(SERVER_ONLY)(
    'no client component can reach $specifier',
    ({ specifier, because }) => {
      const offenders = clientEntryPoints
        .map((entry) => pathToServerOnly(entry, specifier))
        .filter((trail): trail is string[] => trail !== null);

      const report = offenders
        .map(
          (trail) =>
            `  ${trail
              .map((step) =>
                step.startsWith('/') ? relative(REPO_ROOT, step) : step,
              )
              .join('\n    -> ')}`,
        )
        .join('\n\n');

      expect(
        offenders,
        `A client component reaches ${specifier}, which is server-only: ${because}\n\n${report}\n\n` +
          `Turbopack fails this build with a panic that names neither the file ` +
          `nor the import, which is why this test exists.`,
      ).toEqual([]);
    },
  );

  it('stops at a server action instead of walking through it', () => {
    // The guard on the guard. Without the `'use server'` check this reports
    // dozens of client components as leaking Prisma, because that is exactly
    // what a server action is for — and the noise would get the test deleted.
    const actions = join(WEB_SRC, 'app', 'actions', 'index.ts');
    expect(existsSync(actions)).toBe(true);
    expect(hasDirective(read(actions), 'use server')).toBe(true);
    expect(
      valueImports(read(actions)).some((specifier) =>
        specifier.includes('@/generated/prisma/client'),
      ),
      'this file is the fixture for the rule above: it must keep importing the ' +
        'server Prisma entry, so that a broken `use server` check would fail ' +
        'rather than pass quietly',
    ).toBe(true);
  });

  it('treats a type-only import as erased', () => {
    // A component typing a prop with a Prisma enum is not shipping Prisma.
    expect(valueImports("import type { X } from '@/a';")).toEqual([]);
    expect(valueImports("import { type X } from '@/a';")).toEqual([]);
    expect(valueImports("import { type X, type Y } from '@/a';")).toEqual([]);
  });

  it('counts a value import, however it is written', () => {
    expect(valueImports("import { X } from '@/a';")).toEqual(['@/a']);
    expect(valueImports("import X from '@/a';")).toEqual(['@/a']);
    expect(valueImports("import * as X from '@/a';")).toEqual(['@/a']);
    expect(valueImports("import { type X, Y } from '@/a';")).toEqual(['@/a']);
    expect(valueImports("import '@/a';")).toEqual(['@/a']);
    expect(valueImports("export * from '@/a';")).toEqual(['@/a']);
  });
});

describe('the bundler config says what it does', () => {
  const config = read(join(REPO_ROOT, 'apps', 'web', 'next.config.ts'));

  it('declares no webpack function, which Turbopack would never call', () => {
    // The failure this whole file came from: a config block that reads as live
    // behaviour, is documented in AGENTS.md as live behaviour, and does
    // nothing. Re-adding one is a silent no-op, so it is caught here instead.
    const withoutComments = config
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

    expect(withoutComments).not.toMatch(/^\s*webpack\s*:/m);
  });
});
