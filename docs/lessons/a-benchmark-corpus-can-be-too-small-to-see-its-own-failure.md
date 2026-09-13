---
title: A benchmark corpus can be too small to see the failure it was built for, and it looks identical to one that works
modules: [web, worker]
areas: [testing, rag]
topics: [evals, benchmark, chunking, retrieval, corpus-design, false-green, adr-20]
---

## Context

The tables spec needed a measurement before ADR-20 would let a chunking change
ship. The existing `kolej-bilingual-v1` corpus could not provide one — two of
its eight documents contain a table, each five rows in a document of ~1.6 KB
against a chunk budget of 800–2500 characters, so those tables are never split
and the header is never lost. The spec said so and made building a corpus that
*could* see the failure into Phase A rather than a last checkbox.

## Problem

The first corpus built for the job could not see it either, and nothing about
it looked wrong.

It had five documents that were almost entirely tables, 22 rows each, every
figure invented, every question aimed at a row deep in the table with an
`expectNone` drawn from the adjacent column. It validated. It read correctly.
The baseline came out at **12/18**, which looks like a plausible number with
headroom.

It was measuring nothing. Each document was **six chunks**, and retrieval
fetches four. So the chunk holding the header was usually retrieved *alongside*
the chunk holding the asked-about row, the model could align the columns, and
the failure the corpus existed to expose did not occur. One question out of
eighteen actually hit it — and only because that document's chunks ranked
differently.

Going to **sixty rows** — ten chunks per document — dropped the baseline to
10/18 and made seven cases fail the same way, with the answers naming the cause
themselves: *"the provided fragments end at code CD-1978"*, *"the context
includes CNC turning, CNC milling and TIG welding"* — the first rows of a
fifty-row table. Then the change under test moved the median to 13/18.

The 22-row corpus would have produced a *smaller* delta from the same
implementation, and the honest reading of that would have been "table chunks do
not help much".

## Rule

**A corpus built to expose one failure has to be checked against the failure,
not against its own description.** Before trusting a baseline, confirm the
mechanism actually fires:

1. **Count the chunks per document against how many retrieval fetches.** If a
   document is not comfortably more chunks than `maxDocuments`, the chunk you
   are trying to deprive the model of will be retrieved anyway. This is the
   specific trap here and it generalises: a corpus small enough to retrieve
   whole tests nothing about retrieval.
2. **Read the failing answers, not the pass rate.** A model that says *"the
   fragments I was given end at row 12"* is describing the failure under test.
   A model that is simply wrong is describing something else.
3. **Assert the premise in a test.** `shipped-corpora.test.ts` now fails if a
   markdown document's table fits inside one chunk, because that is the
   property the whole corpus rests on and it is invisible in a diff.

The corresponding rule for a *result*: a delta measured on a corpus whose
premise was never checked is not evidence either way.

## Applies to

`apps/web/evals/rag-benchmark` and any corpus added to it; by extension
`evals/e2e-rag` and the promptfoo fixtures, whose premises are different but
equally implicit. The chunk-count reasoning applies wherever a retrieval test
tries to withhold context from a model.
