---
title: 'A CSS escape hatch that matched no element shipped and stayed dead, and the page it was written for never existed'
modules: ['web']
areas: ['frontend', 'architecture']
topics:
  [
    'css',
    'has-selector',
    'dead-code',
    'flexbox',
    'min-height',
    'layout',
    'design-tokens',
  ]
---

# A CSS escape hatch that matched no element shipped and stayed dead, and the page it was written for never existed

**Context**: `docs/panel-ux-rules.md` rule 2 says panel content is capped at 1120px "except table-heavy pages, which run full width (`data-panel-fullwidth`)". `apps/web/src/app/[locale]/global.css` carried the mechanism, with a comment naming its motivating case:

```css
/* … Used by table-heavy pages (e.g. leads detail). */
.panel-content-wrapper:has([data-panel-fullwidth]) {
  max-width: none;
}
```

**Problem**: nothing in the repository carried either half. `SidebarLayout` set the cap on `<div className="flex w-full max-w-6xl flex-col 2xl:max-w-[100rem]">` — no `panel-content-wrapper` class — and no page set `data-panel-fullwidth`. A repo-wide grep returned exactly one hit: the rule itself. The "leads detail" page it cites does not exist either; the only `leads` matches in `apps/web` are the English verb in three comments.

So the documented way to opt a page out of the cap was a no-op, and had been since it was written. Nothing warns: the rule is valid CSS, it parses, it is served, and `:has()` simply never matches. Typecheck, lint, the build and every architecture guard are green either way — they look at TypeScript and at class *literals*, not at whether a selector selects anything.

Two things followed once the hook was made real, and both are the general shape of this trap rather than details of this page:

- **The rule's dependency ran the other way from the elements.** The cap lives on the child; the padding and the height live on the parent. Wiring only the child widened the page and left 40px of white around a full-bleed table — so the escape hatch needed a second rule keyed off the same descendant, on a second class.
- **A `height` plus `overflow: hidden` needs an unbroken `min-h-0` chain, and a single `display: block` in the middle voids it silently.** `knowledge/Providers.tsx` wrapped every page under `/knowledge` in a plain `<div className="grow mr-2">`. The page's `flex-1` resolved against nothing, the div grew to its content, and rows ran past the panel edge and were **clipped rather than scrolled** — which reads as a broken table, not as a broken wrapper four components up.

**Rule**: a CSS hook is not wired until something matches it. Before building on an escape hatch that documentation describes, grep for both halves — the selector *and* the attribute or class it keys on — and confirm the page it cites exists; a comment naming a motivating case is not evidence the case shipped. When you do wire one up, verify it in the browser with `getComputedStyle` or a measured `getBoundingClientRect`, because every static check in this repository passes on a selector that matches nothing.

And when a layout hands a definite height down to a scroller, the chain is the contract: every element between the bounded ancestor and the scroller must be a flex container with `min-h-0`. Check the chain in the DOM rather than in the file you are editing — the break is usually in a provider or layout nobody thought of as layout.

**Applies to**: `apps/web/src/app/[locale]/global.css`, `apps/web/src/libs/common-ui/SidebarLayout/SidebarLayout.tsx`, and any page opting into `data-panel-fullwidth`. `:has()` fires for *any* descendant, so exactly one element per route may carry the attribute. The same "hook with no consumers" shape is worth checking for wherever `docs/panel-ux-rules.md` describes a mechanism rather than a value.
