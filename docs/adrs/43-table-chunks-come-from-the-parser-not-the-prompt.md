# ADR-43: Table Chunks Come From the Parser, Not From the Prompt

**Status:** Accepted, shipped behind a flag, awaiting the Phase C decision.
**Date:** 2026-09-12
**Supersedes:** the Phase 4c half of [ADR-20](./20-pause-and-measure-rag-quality.md)'s Path B.

## Context

[ADR-17](./17-type-specific-chunking.md) found that a CSV cut by character
budget puts the header row in the first chunk and nowhere else, so chunks 2, 3
and 4 are rows of numbers with no column names. It fixed that for CSV *files*
with a row-group splitter that repeats the header, and deferred the rest:

> Phase 4c: PDF table extraction. Extract tables as atomic chunks with
> `chunk_type: 'table'` metadata.

[ADR-20](./20-pause-and-measure-rag-quality.md) then paused 4c along with every
other chunking change, pending a measurement, and asked in its decision item 4
for a **successor ADR** when 4c was eventually done. This is that ADR.

ADR-20's Path B scoped 4c as one of two things:

> modify the ADR-18 structured prompt to emit tables as separate top-level
> entries with `chunk_type: 'table'`, or add a dedicated PDF table extraction
> library.

Neither is what shipped, because the world moved underneath that sentence.

**Docling became the default parser** after ADR-20 was written. It is already a
dedicated table-extraction library, it runs locally in `docker compose`, and it
hands the worker a fully parsed table — cells, row and column offsets, spans,
and a `column_header` flag on the cells that hold the column names — which the
worker read the page count out of and then discarded. Path B's prompt route now
applies only to the ADR-18 fallback, and buying a second library would duplicate
something already running.

**And the problem grew.** `DOCLING_SUPPORTED_TYPES` came to include `CSV` and
`XLSX`, while `split-documents.ts` returns to the markdown splitter for
everything Docling parsed — before the `FileType` switch that would have routed
spreadsheets to the row-group splitter. So on the default parser, ADR-17's fix
no longer reaches the two file types it was written for. See
[`docs/lessons/docling-routes-spreadsheets-past-the-csv-splitter.md`](../lessons/docling-routes-spreadsheets-past-the-csv-splitter.md).

## Decision

**Phase 4c is delivered on the parser's output, not on a prompt and not on a
second library.** A table Docling parsed is lifted out of the markdown and
re-emitted as its own chunks, which repeat the column names Docling flagged.

Four parts of that are decisions rather than implementation:

**The table leaves the prose.** A table that becomes its own chunk *and* stays
in the markdown puts the same figures in the index twice. [ADR-15](./15-multi-query-expansion.md)'s
dedupe is an exact `pageContent` match, and a table chunk with repeated headers
is a different string from the prose chunk containing the original — so the two
are not collapsed. They compete for the same reranker slots and spend the
context budget twice on one set of numbers. A placeholder line takes its place,
so the prose keeps a referent.

**Excision is all-or-nothing, and validated by content.** Markdown tables are
found as runs of lines beginning with a pipe, and paired in order with the
parsed tables. Equal counts are *not* proof of a correct pairing: one table
serialised by Docling as an HTML `<table>` removes a run while a fenced code
block containing a markdown table adds one back, and from that point the
mapping is wrong. So each candidate is compared against its paired table cell
by cell on normalised text before anything is removed, and a single failure
refuses the whole document. Refusals are typed and counted, because a flat
benchmark result that came from excision never running is a different finding
from one that came from table chunks not helping.

**Header repetition comes from `column_header`, never from a heuristic.**
Docling states which cells hold the column names — confirmed on its HTML,
markdown and spreadsheet backends and pinned by
`apps/worker/src/services/__tests__/docling-table-contract.test.ts`. A table
with no such cell is emitted with no repetition at all: repeating an arbitrary
first row is worse than repeating nothing, because it reads as authoritative.

**A table chunk renders as markdown pipes, not CSV.** The surrounding chunks
are markdown, Docling's own serialiser emits pipes, and a reader following a
citation to a table chunk should see a table rather than a comma soup. This is
a retrieval-affecting choice, which is why it is written down rather than left
to whoever wrote the renderer.

## Why it is behind a flag

`FEATURE_FLAG_TABLE_CHUNKS`, default off — a worker-local environment toggle in
the family of `FEATURE_FLAG_RERANKING` and `DOCUMENT_PARSER`.

Deliberately **not** a `FEATURE_KEYS` entry in `@ragenai/platform-contracts`.
That mechanism resolves per organization through four layers, for capabilities
an operator sells or grants. A chunking strategy resolved per organization
would put two chunk shapes in one Qdrant collection.

ADR-20 forbids shipping a chunking change without a number, and the number
exists:
[`apps/web/evals/rag-benchmark/results/2026-09-12-tabele-bilingual-v1-baseline.md`](../../apps/web/evals/rag-benchmark/results/2026-09-12-tabele-bilingual-v1-baseline.md).
Building that baseline was itself a finding — the existing `kolej-bilingual-v1`
corpus cannot see this failure, because its two tables are five rows each and
are never split, and a first draft of the new corpus could not see it either
until its tables were long enough that the header chunk stopped being retrieved
alongside the row being asked about.

## Consequences

**A spreadsheet's chunking changes completely, not marginally.** It is entirely
table, so with the flag on its whole content becomes table chunks and its
markdown becomes a placeholder. That is the intended effect — it restores what
ADR-17 gave CSV before Docling became the default — but it is the largest
behaviour change in the flag, which is why a spreadsheet is in the Phase A
corpus and in the flag-off byte-identity test.

**Element labels are plumbed and unused.** Dropping `page_header` and
`page_footer` before they reach a chunk is a second change to chunk content;
measuring two content changes together produces a number that cannot say which
one worked.

**Tables still have no bounding boxes.** The
[element-provenance](../specs/2026-09-12-element-level-provenance.md) anchor
walk must stay `texts`-only, because widening it advances a shared cursor and
silently breaks `source_page`. Reading `tables[i].prov[0].page_no` — which this
does, for the chunk's page — uses no cursor and is safe. Anchoring a table to a
rectangle needs a second pass with its own cursor, and is a follow-up to both
specs.

**Turning the flag off later leaves table chunks in the index** for documents
ingested meanwhile. They are ordinary chunks with a `chunk_type` nothing
branches on, so they degrade to duplicated context rather than errors, and a
re-index removes them.

## What would change this decision

A Phase C comparison that does not beat the baseline. Reverting is the honest
response to a flat result, and ADR-20 exists because shipping without that step
is what produced this backlog in the first place.
