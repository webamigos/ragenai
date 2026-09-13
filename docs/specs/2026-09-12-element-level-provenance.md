---
title: Element-level provenance from Docling
status: delivered
areas: [worker, rag, knowledge-base]
adrs: [18, 20, 33]
---

# Element-level provenance from Docling

## TLDR

Docling already hands the worker a bounding box for every text element it
parses, and the worker keeps the page count, one offset per page, and discards
the boxes. This spec carries them through ingest so a citation can highlight the
block of text it came from instead of naming a file. Chunking does not change,
which is what earns the exemption from an ADR-20 measurement — but that
exemption rests on an invariant in `buildPageAnchors` that the most natural next
edit destroys, so the invariant is written down here and tested, not assumed.

## Problem

**The data is already paid for and thrown away.** `convertWithDocling`
([docling-client.ts](../../apps/worker/src/services/docling-client.ts)) receives
`md_content` and `json_content` from docling-serve. `json_content` is the full
`DoclingDocument`, every element carrying `prov` with a page number and a box.
Two things are read out of it — the page count, and one anchor per page — and
`convertWithDocling` returns `{ markdown, pageCount, pageAnchors }`
([docling-client.ts:261](../../apps/worker/src/services/docling-client.ts)).
**Every coordinate is discarded at that return**, before
[load-docling.ts](../../apps/worker/src/activities/loaders/load-docling.ts) is
reached: the loader never sees `json_content` at all, which is why this spec's
changes are in the client and not in the loader.

Confirmed against the running `docling-serve-cpu:v1.32.0` by converting
`apps/web/evals/e2e-rag/fixtures/regulamin-wilczy-mlyn.pdf`. The response is
`DoclingDocument 1.10.0`:

```json
{
  "self_ref": "#/texts/0",
  "label": "text",
  "content_layer": "body",
  "prov": [
    {
      "page_no": 1,
      "bbox": {
        "l": 16.6,
        "t": 772.38,
        "r": 592.69,
        "b": 737.01,
        "coord_origin": "BOTTOMLEFT"
      },
      "charspan": [0, 133]
    }
  ],
  "text": "ZAKLADY HYDRAULICZNE WILCZY MLYN sp. z o.o. …"
}
```

with page geometry alongside: `pages["1"].size = { width: 612, height: 792 }`.

**The cost is visible in the code that works around it.**
[source-pages.ts](../../apps/worker/src/services/text-splitters/source-pages.ts)
recovers a chunk's page by searching the flat markdown for the chunk's own
opening text — a 60-character probe, a 400-character verification, and a
documented willingness to give up. That page number was an integer in
`prov[0].page_no` before the flattening.

**What a user cannot do today.** A citation already carries `fileId`,
`sourcePage`, `snippet`, the distinct pages and the reranker score
([events.types.ts](../../apps/web/src/features/threads/contracts/events.types.ts)).
What it cannot do is show _where_ on page 7 the passage sits. This is the queued
"citation source snippets in a drawer" idea, which stalled on chunk-level
identity; a box is that identity.

**What this is not.** Docling's box is per **element**, not per sentence. The
fixture's first box spans `l: 16.6 → r: 592.69` on a 612-point page — the full
column width. The feature is "highlight the paragraph this came from", and the
copy should say so. Promising sentence-level precision would be a promise the
parser cannot keep.

**Prior art, for calibration.** ByteIt Studio (studio.byteit.ai) ships this as a
product: a 12-page report becomes 230 typed elements — 88 paragraphs, 40 page
footers, 30 list items, 27 section headers, 20 tables, 18 images, 7 page headers
— each with a box and a reading order, in a split view where hovering an element
highlights its rectangle. Its taxonomy maps one-to-one onto Docling's labels:
what we lack is not a parser, it is a payload we discard. Worth noting against
over-scoping — in its own demo `hierarchy_level` is `-1` on all 27 headers and
`entities`, `links` and `tags` are empty throughout.

## Out of scope

- **Element _types_ on chunks**, and dropping page headers and footers before
  they reach a chunk. That changes chunk content and owes a measurement. It
  belongs with the [tables spec](./2026-09-12-tables-as-their-own-chunks.md).
- **Tables and pictures.** They are the elements a reader most wants highlighted
  and they get nothing here, which is a real gap and not an oversight — see
  "Why texts only" below for the constraint and the safe way to lift it later.
- **Retiring the iframe viewer** on the document route
  (`(panel)/document/[documentId]/PdfViewer.tsx`). Consolidating the two
  components named `PdfViewer` is independently useful and has nothing to do
  with provenance. An earlier draft of this spec carried it; it was the largest
  risk in the plan and the only thing needing a `p0`, in service of a route this
  feature never touches. Separate PR.
- **An element-browser panel.** Needs the parse persisted per file; highlighting
  does not, because the boxes ride the chunks that were retrieved.
- **Replacing Docling.** `DOCUMENT_PARSER` and ADR-27 untouched.
- **Highlighting non-PDF formats.** DOCX and XLSX carry boxes where a page
  exists, but there is no page raster to draw on.
- **The thread-documents ingest path**
  (`apps/web/src/app/api/threads/services/saveDataInVectorTable.ts`) — a
  separate Qdrant write path for files dropped into a chat. Same carve-out the
  document-language spec made.

## Proposed solution

### Normalise at the worker boundary, not in the UI

Docling reports absolute points from a **bottom-left** origin: above, `t:
772.38` is _higher on the page_ than `b: 737.01`. pdf.js renders a canvas with a
top-left origin at a user-chosen `scale`. Converting in the component means
every consumer needs the page size, the origin flag and the zoom, and gets one
of them wrong.

The worker converts once, to a fraction of the page with a top-left origin:

```
x = l / pageWidth
y = (pageHeight - t) / pageHeight      // BOTTOMLEFT
w = (r - l) / pageWidth
h = (t - b) / pageHeight
```

For the fixture's first element, `y = (792 − 772.38) / 792 = 0.0248` — a header
2.5% down the page. The overlay is `left: 2.48%` over the rendered page box,
correct at every zoom with no further arithmetic. When `coord_origin` is
`TOPLEFT`, `y = t / pageHeight` and `h = (b - t) / pageHeight`; the flag is read,
never assumed.

**Rejected:** store raw points plus page size and convert in the viewer. It puts
a coordinate-system branch in a React component and makes every future consumer
re-derive it. Lossless either way.

### Extend the anchor walk instead of re-chunking

`buildPageAnchors` already walks elements in order, locates each one's text in
the markdown, and records an offset. It keeps one anchor per page and discards
the rest. It will keep **one anchor per located text element**, each carrying
the page and the converted box.

`source_page` keeps its definition: the page of the last anchor at or before the
chunk's start. **A denser anchor list cannot change that value.** The cursor in
`buildPageAnchors` advances for every _located_ element, before the
`page !== lastPage` dedup — so the set of located elements and their offsets are
already independent of anchor density, and offsets ascend. For any offset, the
last anchor at or before it lies inside the same page-run as before, and carries
the same page. No chunk boundary and no chunk text moves.

**Rejected:** chunk from the elements, the way `splitPdfDocuments` chunks ADR-18
sections. Provenance would be exact — one chunk, one element — instead of a span
reconstructed by search. But it replaces the markdown splitter on the Docling
path, changing what gets retrieved, which puts this behind an eval run for a
benefit invisible to the user. It is the right shape for the [tables spec](./2026-09-12-tables-as-their-own-chunks.md).

### Two invariants that hold the argument up

The exemption above is not a property of the feature; it is a property of two
things staying true. Both are broken by edits an implementer would consider
obvious, and neither fails loudly.

1. **The walk stays `texts`-only.** Adding `tables` or `pictures` to the same
   loop inserts `markdown.indexOf(trimmed, cursor)` calls that advance the
   _shared_ cursor. A later text element then matches a later occurrence of its
   string, or misses entirely and is dropped — the anchor vanishes and
   `source_page` changes. Tables can be anchored safely, but only by a **second
   pass with its own cursor**, never by widening this loop. That is the
   follow-up path, written down so the [tables spec](./2026-09-12-tables-as-their-own-chunks.md) does not rediscover it.
2. **An unusable box drops the region, not the element.** When `pages[n].size`
   is missing, the element still gets its anchor and still advances the cursor;
   only the box is omitted. `continue`-ing the loop is the obvious
   implementation and it skips the cursor advance, with the same cascade as (1).

### Where a chunk's span ends

The regions belonging to a chunk are those of the anchors inside it — but
`attachSourcePages` computes only a **start**. There is no end, and
`start + pageContent.length` is not one: the whole reason `locate()` uses a
probe plus a verification is that the splitter alters characters between the
markdown and the chunk.

**Decision: bound the span by `start + pageContent.length` anyway, and accept
the error.** The consequence of being a few characters wrong is that an element
straddling the boundary is included or excluded — one extra rectangle on a
paragraph adjacent to the one cited, or one missing on the last. For a
highlight that is a cosmetic difference; for `source_page` it would have been a
correctness failure, which is why that value keeps its existing derivation from
the start offset alone and does not touch this.

**Rejected:** extend `locate()` to verify the chunk's tail and return a true
end. It is the correct answer for an exact span, and it reworks the one function
whose failure mode is already carefully tuned, to remove a cosmetic error.

### Unify the metadata type before adding to it

`VectorStoreDocumentMetadata` exists twice, hand-kept:
`apps/worker/src/services/llm/types/vector-store.ts` and
`apps/web/src/app/lib/types/types.ts`. They have **already drifted, in both
directions** — the worker copy has `chunk_type`, `pii_policy`, `pii_alert`,
`pii_detected_entities`, `pii_masked_entities`, `section_path`, `sheet_name`,
`timestamp_start_ms`, `timestamp_end_ms` and `language`; the web copy has
`accessible_by`, read by the chatbot metadata filter. Eleven fields apart.

An earlier draft's answer was an architecture test asserting the copies agree.
That is indefensible against ADR-33, which says of exactly this pattern that
_"the tests were not enough, because they only covered what someone thought to
compare"_, and whose decision was to move the shared thing into a package.
`@ragenai/rag-core` is already consumed by web, api and worker and already owns
`vector-contract.ts`. **The type moves there**, re-exported from both existing
paths so no import churn lands in the same step. Every divergent field is
optional, so the union is safe in both directions.

This is a prerequisite, not a nicety: adding a twelfth field to a drifting pair
while citing ADR-33 in the front matter is the failure ADR-33 was written about.

### The renderer does not currently work

An earlier draft claimed `react-pdf` was ready to use — already a dependency,
worker already aliased, "no build configuration". That claim was wrong and the
correction is load-bearing for Phase B's cost.

- `next.config.ts:102` aliases `pdfjs-dist` to
  `apps/web/node_modules/pdfjs-dist/legacy/build/pdf.js`. **That file does not
  exist**, for two independent reasons: `pdfjs-dist` is hoisted to the root
  `node_modules` in this workspace, and `pdfjs-dist@5.4.296` ships only `.mjs`
  — there is no `pdf.js` in `build/` or `legacy/build/`.
- The alias lives in a `webpack:` block, while `apps/web` runs bare `next dev` /
  `next build` on Next 16, where Turbopack is the bundler.
- [`DocumentPreview/viewers/PdfViewer.tsx`](../../apps/web/src/app/components/ManageKnowledge/DocumentPreview/viewers/PdfViewer.tsx)
  has **no test**: `viewers.test.tsx` mocks `mammoth` and `dompurify` and never
  imports it.

So nobody knows whether that component renders. Phase B therefore opens by
proving it does — or making it — before anything is built on top.

## Core surfaces touched

| Surface                | Change                                                                                                                                   | What catches a mistake                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `prisma/schema.prisma` | none — Qdrant payloads are schemaless and the field is optional                                                                          | n/a                                          |
| `packages/rag-core`    | gains `VectorStoreDocumentMetadata`, re-exported from both former homes                                                                  | package tests + web, api and worker builds   |
| auth / tenant scoping  | none — boxes ride the existing org-scoped payload; `/api/files/{id}` already guards on `organizationId` **and** `fileAccessWhere(actor)` | the route's existing guard; no new read path |
| `apps/worker` ingest   | `buildPageAnchors` returns richer anchors; `attachSourcePages` collects boxes                                                            | the end-to-end anchor regression test in A3  |
| `apps/web` chat route  | the sources block becomes interactive and hosts a document preview for the first time                                                    | component tests + a `p1` e2e                 |

## Data model

**No Postgres migration.** One optional field on the Qdrant chunk payload:

```typescript
/**
 * Where on the page this chunk's text sits, as top-left-origin fractions of
 * the page box, 0–1. One entry per Docling *text* element the chunk covers, in
 * reading order. Tables and pictures are not represented.
 *
 * Absent — never empty — when the parser gave no usable box: every non-Docling
 * loader, every unpaginated format, and any element whose text could not be
 * located in the markdown. **Absence is the discriminator**, the same rule as
 * `source_page`: the overlay renders only where this is present, so a chunk
 * ingested before the field existed cannot be drawn by a rule it predates.
 */
source_regions?: Array<{
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}>;
```

Written by `prepareMetadata` from a camelCase `sourceRegions`, the boundary and
convention ADR-17 established.

**Existing chunks are not backfilled.** No regions, no overlay; a re-index
upgrades a document, the rule already stated for the inert `page_number` field.

**Payload size.** Five numbers per region; a chunk covering six elements adds
roughly 200 bytes. Capped at **32 regions**, beyond which a highlight spanning
most of a page tells the reader nothing anyway.

## Failure modes

- **`coord_origin` is `TOPLEFT`.** Read the flag per box. Assuming bottom-left
  flips every rectangle to the wrong end of the page.
- **`pages[n].size` missing or zero.** Skip the region — **and still advance the
  cursor**, per invariant 2.
- **Element text not found in the markdown.** Already expected: headings carry
  markers, tables are rebuilt, OCR differs. One fewer region; `source_page`
  behaves exactly as today.
- **An element spans a page break.** Docling gives it several `prov` entries
  with different pages and boxes; the existing code reads `prov[0]` and this
  spec inherits that. The chunk gets the first fragment's rectangle and none of
  the continuation. Stated rather than silently half-highlighted.
- **Page headers and footers get rectangles.** Labels are out of scope, so
  furniture is anchored like anything else — 47 of ByteIt's 230 elements were
  headers or footers. Harmless, visible, and fixed by the [tables spec](./2026-09-12-tables-as-their-own-chunks.md).
- **Chunk located but no anchors inside its span.** `source_regions` is omitted,
  not `[]`.
- **`json_content` absent or unparseable.** Already handled by
  `parseJsonContent`; no anchors, markdown ingest unaffected.
- **Rotated page.** Docling's page object carries no rotation in the version we
  run, so boxes would be placed against an unrotated frame. A1's fixture asserts
  the field's absence, so a Docling upgrade that adds it fails loudly.
- **PII-masked chunk.** The rectangle points at the _unmasked_ original. Not a
  new exposure — `/api/files/{id}` already serves that PDF to anyone passing
  `fileAccessWhere` — but a highlight can lead a reader to text the chunk
  deliberately masked. A decision, not a discovery.
- **Legacy PDF path.** A PDF ingested with `DOCUMENT_PARSER=legacy`, or one
  where Docling failed and the ADR-18 Claude path took over, produces no
  anchors and therefore no regions. That fallback is live code, not a
  hypothetical.
- **pdf.js fails to load.** The viewer's `onLoadError` renders `error-loading`;
  no highlights drawn.

## Phases

### Phase A — the worker carries the boxes

- [x] **A1.** Pin the parser contract: record the real docling-serve response
      for `regulamin-wilczy-mlyn.pdf` as a fixture and assert the shape this
      spec depends on — `prov[0].bbox` as `{l,t,r,b,coord_origin}`,
      `pages[n].size`, `self_ref`, and the absence of a page rotation field. No
      production code.
- [x] **A2.** Move `VectorStoreDocumentMetadata` into `@ragenai/rag-core` as the
      union of the two copies, re-exported from both former paths. Pure type
      move, no behaviour change, no import churn.
- [x] **A3.** `buildPageAnchors` → `buildTextElementAnchors` (inside
      `convertWithDocling`, widening its return type): one anchor per located
      text element, each with page and normalised box. Both invariants
      documented at the loop. The regression test runs the A1 fixture through
      the old and new implementations **end to end** and asserts the whole
      chunk output is identical — count, `pageContent`, order, and every
      metadata field, not only `source_page`. Asserting pages alone would pass
      an implementation that moved chunk text or boundaries while preserving
      page assignment, which is exactly the change this spec claims not to
      make. The existing `source-pages.test.ts` feeds a hand-written anchor
      list and cannot see any of it, because the change is in the producer, not
      the consumer.
- [x] **A4.** Add `source_regions` to the unified type; `attachSourcePages`
      collects anchors inside each chunk's span onto `sourceRegions`, capped at
      32; `prepareMetadata` maps it into the payload. New ingests carry boxes;
      nothing reads them.
- [x] **A5.** Surface `sourceRegions` on `RetrievalSource` and the persisted
      retrieval read path, following the optional-on-restore split #1071
      established. Nothing renders it.

### Phase B — the chat shows them

- [x] **B1.** Make the react-pdf viewer provably work: fix the `pdfjs-dist`
      alias for the hoisted, `.mjs`-only package under Turbopack, and add the
      component test it has never had. If it already works, this step is the
      test alone — but that is a finding, not an assumption.
- [x] **B2.** Optional `highlights` and `initialPage` props on that viewer, with
      an absolutely-positioned overlay over `<Page>`. With no highlights it
      behaves exactly as before. Copy and `aria-hidden` land here, with all 15
      locale files, in the step that introduces the strings.
- [x] **B3.** Make source cards in `SourcesBlock` activatable. The component has
      no button, link or handler today, so this is the interaction being added,
      not wired.
- [x] **B4.** Host the document preview in the chat route — `DocumentPreviewSlideOver`
      is currently mounted only in `ManageKnowledge/UserFiles/UserFilesWrapper.tsx`
      — and open it at the cited page with that source's regions highlighted.

B3 and B4 together are the queued "citation source snippets in a drawer" item
being discharged. Naming it here is the point: it is two steps of real work, not
a checkbox on the end of an ingest change.

## Testing

- **Unit (worker):** coordinate conversion for both `coord_origin` values;
  missing or zero page size; an element whose text is not in the markdown; a
  chunk covering several elements; a chunk covering none; the 32-region cap.
- **Unit (worker), the load-bearing one:** the A3 end-to-end anchor regression
  above — full chunk equality, not page equality. The claim being defended is
  "no chunk boundary and no chunk text moves"; a test that compares only
  `source_page` defends a weaker claim than the one the ADR-20 exemption rests
  on. If it fails, the exemption evaporates.
- **Unit (worker), invariant guards:** a case with a table between two text
  elements asserting the text anchors keep their offsets, and a case with an
  unusable box asserting the element still anchors. These are the two silent
  breaks; without them the invariants are comments.
- **Package:** `rag-core` exports the unified metadata type; web and worker
  builds prove both consumers compile against it.
- **Component (web):** the viewer with no highlights renders as before; with
  highlights renders one box per region at the expected percentage offsets; an
  unknown page draws nothing. New coverage, not extended — B1 adds the first
  `react-pdf` mock.
- **E2E `p1`:** activating a cited source opens the preview at the right page
  with a highlight present. No `p0`: this spec no longer touches an existing
  core screen, because the iframe viewer is out of scope.

## Rollout and rollback

**Phase A is inert data.** No migration, no flag; "revert the PR" is a complete
answer. A revert after A4 leaves `source_regions` on some chunks — optional and
ignored, costing payload bytes and nothing else. A2 is a type move and reverts
the same way.

**Phase B introduces no stored state** and also reverts by PR. Its risk is
concentrated in B1, which is why B1 exists as a step instead of an assumption.

**Forward migration** for existing documents is a re-index
(`Workflow.REINDEX_DOCUMENT_VERSION`), not a backfill. Until then those
documents cite exactly as they do today.

**Ordering against the [tables spec](./2026-09-12-tables-as-their-own-chunks.md).**
Both specs rewrite `convertWithDocling` and widen the same return type, and that
spec's markdown excision changes the very string A3 anchors against. **This spec
lands first**: it is smaller, its output is inert, and rebasing an excision
change onto a finished anchor rewrite is easier than the reverse.

**On ADR-20.** The pause it imposed was discharged by the measurement that
landed today — `05576e6a`, written up in
[docs/rag-measurement-2026-09-12.md](../rag-measurement-2026-09-12.md). This
spec does not reopen it: it argues it changes nothing retrieval can observe, and
A3 is the test of that argument.
