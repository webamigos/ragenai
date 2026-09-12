---
title: Tables as their own chunks
status: delivered, flag off pending the default decision
areas: [rag, worker]
adrs: [15, 17, 20, 33, 37]
---

# Tables as their own chunks

## TLDR

Docling detects tables and flags their header cells; the worker flattens them
into the markdown stream, where the character splitter cuts them at an arbitrary
byte and every piece after the first is rows of numbers with no column names.
That is the failure ADR-17 wrote down and fixed for CSV _files_, and which — on
the default parser path — applies to tables inside documents **and to CSV and
XLSX files themselves**. This is ADR-20's deferred Phase 4c. The non-obvious
part: the benchmark that would prove it works cannot currently see the change,
so building the measurement is Phase A, not the last checkbox.

## Problem

**Verified in the code.** `apps/worker/src/services/text-splitters/` holds five
splitters and none knows what a table is. `markdown-text-splitter.ts` is the
generic recursive splitter with markdown separators (`\n## ` … `\n\n`, `\n`,
` `, `''`), so a pipe table is cut at a newline like any prose. The only
occurrences of the word "table" are a comment in `csv-row-group-splitter.ts`
explaining why _its_ strategy exists, and one in `docx-heading-splitter.ts`
conceding that table rows fall through as plain paragraphs.

On the Docling path — the default — everything becomes one flat markdown string
cut by `splitMarkdownDocuments`
([split-documents.ts:48](../../apps/worker/src/activities/splitters/split-documents.ts)).
ADR-17 already described the consequence, for CSV:

> The **header row appeared only in the first chunk**. Chunks 2, 3, 4, … were
> just rows of numbers with no column names. A user asking "what was Q3
> revenue?" had to match their query against a chunk containing `1,200,000`
> with no nearby indication that the column means revenue.

**And ADR-17's fix is not reaching CSV and XLSX any more.**
`DOCLING_SUPPORTED_TYPES` (`apps/worker/src/utils/docling.ts`) contains `CSV`,
`XLSX`, `MARKDOWN` and `TEXT` alongside the document formats, and
`split-documents.ts` returns to the markdown splitter for **everything** Docling
parsed, before the `FileType` switch that would have routed CSV and XLSX to the
row-group splitter. `load-docling.ts` says so in its own comment — _"For
spreadsheets (XLSX/CSV), Docling produces Markdown tables rather than raw CSV,
which means the output goes through the markdown splitter instead of the CSV
row-group splitter"_ — and calls it intentional. Whatever the intent, the
header-repetition ADR-17 shipped is bypassed on the default parser for the two
file types it was written for. That widens this spec's motivation and its risk:
a spreadsheet is _entirely_ table, so the flag changes its chunking completely,
not marginally.

ADR-17 deferred the rest explicitly — _"PDF — No change in Phase 4a — deferred
to Phase 4b (heading heuristic) and 4c (table extraction)"_ — and named the
shape this spec builds: _"Phase 4c: PDF table extraction. Extract tables as
atomic chunks with `chunk_type: 'table'` metadata"_
([ADR-17:131](../adrs/17-type-specific-chunking.md)). ADR-20 then paused 4c
pending a measurement, which landed today
([docs/rag-measurement-2026-09-12.md](../rag-measurement-2026-09-12.md)).

**Docling hands us the header, flagged.** Confirmed against the running
`docling-serve-cpu:v1.32.0` by converting an HTML document with a three-column
table. `tables[0].data` carries `num_rows`, `num_cols`, `grid` and
`table_cells[]`, each cell shaped:

```json
{
  "text": "Kwartal",
  "column_header": true,
  "row_header": false,
  "row_span": 1,
  "col_span": 1,
  "start_row_offset_idx": 0,
  "end_row_offset_idx": 1,
  "bbox": null
}
```

`column_header` is the whole design: the row-group strategy needs to know which
row to repeat, and the parser states it instead of leaving us a heuristic. The
same probe showed `captions: []` and, for an HTML source, `prov: []` — so
neither a caption nor a page can be assumed present. **That probe covered
Docling's HTML backend only**, which A1 must fix; see below.

**Why it matters at the scale customers bring.** In the ByteIt Studio sample
examined for the [provenance spec](./2026-09-12-element-level-provenance.md) — a
12-page equity research note — 20 of 230 elements were tables against 88
paragraphs. Financial and regulatory documents are the case where the numbers
live in the tables and the prose is commentary.

**The measurement cannot see it today.** `kolej-bilingual-v1` is the only
harness that tests real retrieval in both languages. Two of its eight documents
contain a table; each is five rows in a document of roughly 1.6 KB, against a
chunk budget of 800–2500 characters — so those tables are never split and the
failure this spec fixes never occurs. Its 24 questions include no type for "a
value in a wide table". A pass rate that did not move would be evidence of
nothing at all.

## Out of scope

- **Bounding boxes for tables.** The
  [provenance spec](./2026-09-12-element-level-provenance.md)'s anchor walk must
  stay `texts`-only: widening that loop advances a shared cursor and silently
  breaks `source_page`. Anchoring tables needs a second pass with its own
  cursor — a follow-up to both specs. Reading `tables[i].prov[0].page_no`
  directly is **not** that, and is in scope here; see the data model.
- **Filtering `page_header` / `page_footer` out of chunks.** Labels are plumbed
  here; nothing acts on them. Dropping furniture is a second change to chunk
  content and needs its own arm — two content changes measured together produce
  a number that cannot say which one worked.
- **The ADR-18 Claude PDF path.** `DOCUMENT_PARSER=legacy`, and the fallback
  after a Docling failure, keep today's behaviour.
- **Table rendering in the answer context.** ADR-19's `<chunk>` wrappers are
  presentation, not retrieval.
- **Extending `kolej-bilingual-v1` in place.** Its rev1/rev2 results are dated
  today and stay comparable.

## Proposed solution

### Where this diverges from ADR-20, and the successor ADR

ADR-20's Path B scopes Phase 4c as _"modify the ADR-18 structured prompt to emit
tables as separate top-level entries with `chunk_type: 'table'`, or add a
dedicated PDF table extraction library"_ — and its decision item 4 asks to
**open a successor ADR** for 4c specifically.

This spec does neither of the two things Path B lists, because the world changed
underneath it: Docling became the default parser after ADR-20 was written, and
it is already a dedicated table-extraction library whose output we discard. Path
B's prompt-engineering route now applies only to the fallback, and buying a
second library would duplicate what is running in `docker compose`. Taking the
Docling path instead is a substantive enough divergence that it wants the
successor ADR ADR-20 asked for — **ADR-43, opened alongside Phase B**, recording
that 4c was delivered on the parser rather than on the prompt.

### Move the table out of the prose, leave a pointer

A table that becomes its own chunk _and_ stays in the markdown puts the same
figures in the index twice. ADR-15's dedupe is an **exact `pageContent` string
match** (`basic-rag/operations.ts:422` and `:557`, keyed on `doc.pageContent`),
so the two copies are _not_ collapsed: a table chunk with repeated headers and a
prose chunk containing the original table are different strings. They both
survive, compete for the same reranker slots, and spend the context budget twice
on one set of numbers.

So the table block is **excised from the markdown before anchoring and
splitting** and replaced by a single placeholder line naming it — a caption
where Docling provides one, otherwise a stable ordinal. The prose keeps a
referent and the figures live in one chunk.

**Rejected:** leave the table inline and additionally emit a table chunk. No
excision logic and no risk to the prose, at the cost of a duplicate candidate
for every table in every document.

### The excision belongs inside `convertWithDocling`, and nowhere else

This is the step most likely to be built in the wrong module.
`buildPageAnchors` runs at
[docling-client.ts:248](../../apps/worker/src/services/docling-client.ts),
**inside `convertWithDocling`**, which returns only
`{ markdown, pageCount, pageAnchors }`. `loadDocling` never sees
`json_content`, and splitting happens two modules away in `split-documents.ts`.

Therefore:

- `convertWithDocling`'s return type widens to carry the parsed tables and the
  element labels. "Plumb tables through the loader" would be the wrong
  description of the change — the loader is downstream of the only place
  `json_content` exists.
- **Excision runs inside `convertWithDocling`, after `md_content` is read and
  before `buildPageAnchors` is called.** Anchors and the splitter then both see
  the post-excision string. Building excision next to the splitter — the natural
  place — would anchor the pre-excision markdown and cut the post-excision one,
  misattributing the page of every element after the first table. Nothing in the
  repo would catch that.
- The [provenance spec](./2026-09-12-element-level-provenance.md)'s A3 rewrites
  this same function and widens the same return type. **Ordering: the provenance
  spec lands first.** It is smaller, it is inert data, and rebasing an anchor
  rewrite onto an excision change is easier than the reverse.

**And the tables have to reach the splitter, which is three modules further
on.** `loadDocling` forwards only `markdown`, `pageCount` and `pageAnchors` into
a single `Document`, and the Docling branch of `splitText` hands `rawDocs` to
`splitMarkdownDocuments`, which takes no table input. Widening
`convertWithDocling`'s return type is therefore necessary and not sufficient:
without a transport, B3 has nowhere to read the tables from.

The channel already exists and this spec follows it rather than inventing one.
`loadDocling` puts `doclingPageCount` and `doclingPageAnchors` on
`doc.metadata`, and `split-documents.ts` reads them straight back off
`rawDocs[0].metadata`. Tables and element labels ride the same way, as
`doclingTables` and `doclingElementLabels`, spread conditionally like their
neighbours so a document with no tables carries no key. The Docling branch of
`splitText` then reads them exactly where it already reads the anchors, and
emits table chunks alongside the markdown chunks it returns today.

`prepareMetadata` stays the boundary that decides what reaches Qdrant, so these
intermediate keys never land in a payload — the same contract ADR-17 set for
`sectionPath` and `sheetName`.

### Excise by structure, and refuse to guess

Markdown tables are recognisable without heuristics: a run of consecutive lines
beginning with `|`. The pass scans for those runs and pairs them in order with
`json_content.tables[]`.

**A pipe run is not proof of a table, and equal counts are not proof of a
correct pairing.** A fenced code block containing a markdown table, or prose
lines that happen to start with a pipe, produce runs that look identical to the
scanner. Combine that with the mismatch this spec already expects — Docling
serialising one table as an HTML `<table>` rather than pipes — and the two
errors cancel in the count while the pairing is wrong from that point on. The
document then loses a prose block, and the text excised in its place is filed
under a table it never belonged to. That is silent data loss, which is the one
outcome the guard exists to prevent.

So **each candidate is validated against the entry it was paired with before
anything is removed**: the run's cell grid is compared against that entry's
`table_cells` on normalised text — whitespace collapsed, the alignment row
ignored — and the pairing must hold for the row and column counts too. Cheap,
because both sides are already parsed.

**If any candidate fails validation, no excision happens at all**, exactly as
for a count mismatch. All-or-nothing is deliberate: a partial excision means the
mapping is unsound somewhere, and excising the rest on the assumption that the
failure was isolated is how the wrong block gets deleted.

A refusal is not hypothetical: Docling's markdown serializer emits an HTML
`<table>` rather than pipes for some tables with merged cells, and this spec's
own failure modes concede merged cells occur. One such table in a twenty-table
document disables excision for the whole document. That is the right call —
but it means a flat result in Phase C could mean "excision never ran" rather
than "table chunks don't help", so **the refusal is counted and the activation
rate is reported beside the pass rate**. A measurement that cannot tell those
two apart is not a measurement.

### Build the chunk from a shared packing core

`csv-row-group-splitter.ts` is **not** reusable as it stands. `splitCsvDocuments`
takes a `Document` whose `pageContent` is CSV _text_, parses it with
`parseCsvRows`, assumes `rows[0]` is the header (`:160`), and serialises back to
comma-joined fields (`:129`). Docling gives structured `table_cells[]` with
header flags, possibly no header row and possibly several.

What is genuinely reusable is the packing loop (`:181–193`). It is extracted into
a shared `packRows(headerRows, bodyRows, budget, render)`, and the CSV splitter
is rewritten onto the same core so there is one implementation of "repeat the
header, pack to the budget" rather than two.

**A table chunk renders as markdown pipes, not CSV.** The surrounding chunks are
markdown, Docling's own serialiser emits pipes, and a user reading a cited chunk
sees a table rather than a comma soup. Emitting CSV would put a second syntax
inside a markdown corpus for no retrieval benefit — and this is a
retrieval-affecting choice, not an implementation detail, which is why it is
stated rather than left to whoever writes the renderer.

Each table chunk carries `chunk_type: 'table'` (the name ADR-17 already gave
it), `section_path` from the heading stack, `source_page` from the table's own
provenance, and the placeholder text used in the prose.

## Core surfaces touched

| Surface                        | Change                                                                                 | What catches a mistake                     |
| ------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| `prisma/schema.prisma`         | none                                                                                   | n/a                                        |
| `packages/platform-contracts`  | none — see the flag note in Rollout                                                    | n/a                                        |
| `packages/rag-core`            | `chunk_type` union gains `'table'` (after the provenance spec moves the type there)    | package tests + web, api and worker builds |
| `apps/worker` ingest           | `convertWithDocling` return type; excision; a new splitter branch; a shared `packRows` | unit tests + the Phase A benchmark         |
| `apps/worker` env              | one worker-local toggle, newly **added** to `validateEnvVars.ts`                       | nothing today — see M-note in Rollout      |
| `apps/web/evals/rag-benchmark` | a new sibling corpus; the existing one and its results untouched                       | the harness's own corpus validation        |
| CSV / XLSX ingest              | changed by the same flag, because Docling already owns those types                     | corpus includes a spreadsheet; unit tests  |

## Data model

**No Postgres migration.** Chunk payload only:

- `chunk_type?: 'summary' | 'table'` — widening an existing optional union.
  `prepare-metadata.ts` passes the value through and the only reader compares
  against `'summary'`, so nothing branches wrongly on the new value.
- `section_path` — in the schema since ADR-17, now populated for table chunks.
- `source_page` — **must be set on the table chunk**, from
  `tables[i].prov[0].page_no`. Today a table's text lives inside a markdown
  chunk that `attachSourcePages` gives a page to; after excision the table chunk
  is produced outside that path and would silently lose the page, removing the
  UI's "· page {n}" from exactly the content this spec exists to make findable.
  Reading `prov[0].page_no` directly uses no shared cursor and so does not touch
  the provenance spec's invariant. Absent when `prov` is empty — the existing
  discriminator, unchanged.

**Existing chunks are untouched and not backfilled.** A document is upgraded by
a re-index (`Workflow.REINDEX_DOCUMENT_VERSION`), which clears a file's chunks
first. This matters more here than in the provenance spec: until re-indexed, a
collection holds both shapes, so Phase C must re-ingest its corpus rather than
compare against points written before the flag existed.

## Failure modes

- **Markdown table count ≠ `tables[]` count.** No excision, today's behaviour,
  counted and reported with the run.
- **Counts agree but a pairing fails validation.** The dangerous case, because
  the count guard passes: an HTML-serialised table removes one pipe run while a
  fenced code block or pipe-prefixed prose adds one back. Content validation
  catches it; without it the excision deletes prose and files it under a table.
  Same refusal, same counter.
- **Docling emits an HTML `<table>` instead of pipes.** The specific, expected
  cause of both of the above.
- **A table with no `column_header` cell.** Emit as one chunk with no
  repetition. Repeating an arbitrary first row is worse than repeating nothing,
  because it reads as authoritative.
- **A single row wider than the budget.** Emitted whole and over budget — the
  same concession the CSV splitter already makes.
- **`prov: []` on the table.** Confirmed for non-paginated sources. No
  `source_page` on that chunk.
- **Merged cells (`row_span` / `col_span` > 1).** The repeated header is
  flattened; a two-level header renders as one line and some column meaning is
  lost. Better than no header, worse than the original.
- **A table caption inside the excised run.** Captions live in `texts`, not
  `tables[]`, and Docling renders them adjacent — so they should survive, but a
  caption swallowed by the excision drops an anchor and shifts `source_page`.
  One test case covers it.
- **A table inside a list or blockquote.** The consecutive-`|` scan will not see
  an indented block; it stays in the prose. A miss, not a corruption.
- **A spreadsheet whose whole content is one table.** Chunking changes
  completely rather than marginally. The Phase A corpus includes one so this is
  measured rather than discovered.
- **The flag is misspelled.** Nothing fails today: `validateEnvVars.ts` is a
  non-strict Zod object, so an unknown key is stripped silently. Phase C would
  reproduce the baseline and the honest reading of a flat number would be
  "revert Phase B". Mitigated by declaring the variable **and** logging its
  resolved value once per ingest.

## Phases

Phase A is separately landable — a corpus and a baseline are a standalone
benchmark asset, useful whether or not Phase B is ever built. Phase B is not
landable without it, because ADR-20 forbids it.

### Phase A — a measurement that can see the change

- [x] **A1.** Extend the parser probe to Docling's **markdown and spreadsheet
      backends**. The `column_header` flag was verified on the HTML backend
      only, and the corpus below is Markdown — a different table parser. If
      markdown sources do not set the flag, every table falls into the "no
      `column_header`" branch, the feature no-ops, and Phase C reads flat for a
      reason the spec has already pre-labelled acceptable. Build the corpus in a
      format the probe covers.
- [x] **A2.** A new sibling corpus under `evals/rag-benchmark/corpora/`:
      documents whose tables exceed the chunk budget, in both languages, every
      figure invented per the harness's rule, plus **one spreadsheet**.
      Questions target a value in a row far from its header, with an
      `expectNone` drawn from a neighbouring column so a right-shaped answer
      from the wrong column fails.
- [x] **A3.** Baseline run against current `main`, flag absent, committed to
      `results/`. **This is the number the spec is judged against.**

### Phase B — table chunks, behind a flag

- [x] **B1.** Widen `convertWithDocling`'s return type to carry parsed tables
      and element labels, and carry them the rest of the way: `loadDocling`
      spreads them onto `doc.metadata` as `doclingTables` and
      `doclingElementLabels` beside the existing `doclingPageAnchors`, and the
      Docling branch of `splitText` reads them back off `rawDocs[0].metadata`.
      Nothing consumes them yet and ingest output is byte-identical, but the
      transport is testable on its own — a boundary test asserts a table
      survives the trip from `json_content` to `splitText` without disturbing
      `markdown`, `pageCount` or `pageAnchors`.
- [x] **B2.** Extract `packRows` from the CSV splitter and rewrite
      `splitCsvDocuments` onto it. Pure refactor, existing tests unchanged.
- [x] **B3.** Excision **and** table-chunk emission, together, behind
      `FEATURE_FLAG_TABLE_CHUNKS`, with per-candidate validation, the
      all-or-nothing refusal and its counter.
      These are one step, not two: excision without emission removes the figures
      from the index entirely, so a flag-on deployment between them would lose
      data. Includes `source_page`, `section_path` and `chunk_type`.
- [x] **B4.** Open **ADR-43**, recording that Phase 4c was delivered on the
      Docling path rather than ADR-20's Path B, and why.

### Phase C — decide with the number

- [x] **C1.** Re-ingest the Phase A corpus with the flag on; publish the
      comparison beside the baseline, **with the excision activation rate**.
- [x] **C2.** Decide: default on, keep opt-in, or revert Phase B. A flat result
      is an acceptable outcome and reverting is the honest response to one —
      ADR-20 exists because shipping without this step produced the backlog.

## Testing

- **Unit (worker), table building:** header extraction from `column_header`
  cells; no header cell; row grouping at the budget boundary; a single row wider
  than the budget; merged-cell flattening; `section_path` from a heading stack;
  `source_page` from `prov[0]` and its absence when `prov` is empty.
- **Unit (worker), excision:** valid pairing and replacement; count mismatch
  refusing wholesale and incrementing the counter; **an equal-count near miss** —
  one table serialised as HTML plus a fenced code block containing a markdown
  table, so the counts agree while the pairing is wrong — refusing on content
  validation rather than excising the code block; a pipe-prefixed prose line; an
  indented table left alone; a table with a caption; a document with no tables
  unchanged byte-for-byte.
- **Unit (worker), transport:** the B1 boundary test — a table reaches
  `splitText` through `doc.metadata` with `markdown`, `pageCount` and
  `pageAnchors` intact, and a document with no tables carries no key at all.
- **Unit (worker), ordering:** anchors built on the post-excision markdown agree
  with the chunks cut from the same string. This is the coupling with the
  [provenance spec](./2026-09-12-element-level-provenance.md) and nothing else
  would catch it.
- **Unit (worker), flag off:** ingest output byte-identical to pre-spec for a
  document with tables, **and for a CSV and an XLSX** — the two file types the
  flag changes by side effect.
- **Unit (worker), refactor:** the existing CSV splitter tests pass unchanged
  after B2, which is the whole proof that `packRows` preserved behaviour.
- **Benchmark:** A3 baseline and C1 comparison, both committed.
- **E2E:** none. This changes what is indexed, not a screen; the benchmark is
  the gate and an e2e over chunk content would duplicate the unit tests more
  slowly and more flakily.

## Rollout and rollback

`FEATURE_FLAG_TABLE_CHUNKS` is a **worker-local environment toggle**, default
off — `process.env.FEATURE_FLAG_TABLE_CHUNKS === '1'` in
`apps/worker/src/consts.ts`, the shape `DOCLING_STRICT` already has.

It is deliberately **not** a `FEATURE_KEYS` entry in
`packages/platform-contracts`. That mechanism resolves per organization through
four layers — override, plan, platform default, code default — for capabilities
an operator sells or grants, like `apiAccess`. A chunking strategy under
measurement is an installation-wide ingest setting, in the family of
`FEATURE_FLAG_RERANKING` and `DOCUMENT_PARSER`. In `FEATURE_KEYS` it would let
two organizations in one installation hold different chunk shapes in the same
collection.

**The env contract does not currently catch a typo, and this spec adds that.**
`DOCLING_STRICT`, `DOCUMENT_PARSER`, `DOCLING_URL` and the existing
`FEATURE_FLAG_*` variables are **not** declared in `validateEnvVars.ts`, and the
schema is non-strict, so an unknown key is stripped without a word. Declaring
the new flag there is a real improvement rather than an existing safety net —
and because declaring it still would not catch a misspelling in the _deployment_,
the resolved value is logged once per ingest.

Phase B is dead code until the variable is set, so B1–B4 land independently and
"revert the PR" stays a complete answer. B3 is the one step where flag-on
behaviour changes, which is why excision and emission are not split across two
merges.

No migration. Turning the flag off afterwards leaves table chunks in the index
for documents ingested meanwhile; they are ordinary chunks with a `chunk_type`
nothing branches on, so they degrade to duplicated context rather than errors,
and a re-index removes them.
