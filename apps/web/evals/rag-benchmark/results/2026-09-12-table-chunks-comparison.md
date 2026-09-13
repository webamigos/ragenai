# Table chunks — the comparison ADR-20 asked for

`FEATURE_FLAG_TABLE_CHUNKS` off against on, three runs each, on two corpora.
The flag only affects ingest, so each set of three re-ingested its corpus with
the worker configured that way; nothing else in the stack moved.

## The number

| Corpus | Flag off | Flag on | Median |
| --- | --- | --- | --- |
| `tabele-bilingual-v1` (tables longer than a chunk) | 10, 10, 8 | 12, 13, 13 | **10 → 13 of 18** |
| `kolej-bilingual-v1` (general) | 20, 22, 19 | 20, 21, 21 | **20 → 21 of 24** |

The control arm — same model, no documents — scored **0/18** on the table
corpus in all three baseline runs and 0/24 on the general one, so the whole of
both RAG columns is retrieval rather than recall.

**+3 of 18 on the corpus the change is for**, and the flag-on floor (12) is
above the flag-off ceiling (10), which is a stronger statement than the medians
alone: the two sets of runs do not overlap. The harness's own rule is that a
single-run delta under about three cases is noise, and this clears it on the
median while the ranges stay disjoint.

**+1 of 24 on the general corpus**, which is noise — but the point of running
it is that it is not *negative*. Ordinary documents do not pay for this.

## The activation rate, which is not optional

A flat result that came from excision never running is a different finding from
one that came from table chunks not helping, so the rate is reported beside the
pass rate.

| Corpus | Documents | With tables | Excised | Refused |
| --- | --- | --- | --- | --- |
| `tabele-bilingual-v1` | 5 | 5 | 5 | 0 |
| `kolej-bilingual-v1` | 8 | 2 | 2 | 0 |

**Every document that had a table had it excised. No refusals.** The six
general-corpus documents with no table report `no-tables` and are untouched,
which is what the flag-off byte-identity test asserts and what the log confirms
in production shape.

The spreadsheet is the extreme case and behaved as designed: its markdown
collapsed from 29 KB to **9 characters** — `[Table 1]` — with the whole of its
fifty rows re-emitted as table chunks that repeat the column names.

## Which cases moved, on the corpus that matters

Five failing cases became passing, and all five are the failure the corpus was
built to expose. Before, the answers named the problem themselves:

> "the specific hourly rate for scale verification is not mentioned. The
> context includes price list information for CNC turning, CNC milling, and TIG
> welding" — **the first three rows of a fifty-row table.**

| Case | Off | On |
| --- | --- | --- |
| `en-rate-scale-verification-oob` | `...` | `PPP` |
| `en-guard-false-premise` | `...` | `PPP` |
| `en-cap-extensometer` | `...` | `PP.` |
| `en-ask-pl-roughness-oob` | `...` | `.PP` |
| `en-extensometer-cap-and-period` | `...` | `..P` |

One case moved the other way, and it is worth being precise about: `pl-heat-cost`
went `PP.` → `...`. It asks for a figure in the **spreadsheet**, and the
flag-on answer is a refusal that lists exactly which batches it was given:

> "brakuje informacji na temat partii o numerze WT-3140 … Dostępne dane
> zawierają m.in. partie od WT-3131 do WT-3135 oraz od WT-3141 do WT-3150"

The row exists in a table chunk; that chunk did not rank, and the two chunks
either side of it did. This is a retrieval miss on one row rather than data
loss, and the model refused rather than inventing — which is the behaviour the
guards test for. Flag-off it passed because the character splitter happened to
put that row in a chunk that ranked.

## The general corpus, and its one consistent difference

Four cases differ between the two sets of three runs, all cross-lingual, and
three of them flicker in both directions — ordinary judge and reranker noise.
The one that is consistent is `xl-en2pl-refund-pct`, `PPP` → `.PP`, and it is a
**grading artefact rather than a regression**:

> "Kolej Nadwiślańska S.A. charges 9.80 PLN for a single bicycle trip … Another
> document regarding the bicycle tariff lists the single bicycle fare as 3.40
> EUR [4]."

The right figure, correctly attributed, plus the sibling document's figure
correctly attributed to the sibling document — which trips an `expectNone`
written to catch an answer that confused the two. The flag caused it by making
both tables cleanly retrievable, so the model saw both. Better retrieval, worse
grade. `kolej-bilingual-v1`'s rev2 questions were written before table chunks
existed and this is the shape of question that assumes they do not.

## Recommendation: default on

The change does what it was built to do on the corpus built for it, does not
cost anything measurable on ordinary documents, and refused nothing in thirteen
documents. The excision's guards were exercised by the unit tests rather than
by these runs, which is the honest reading of a 0% refusal rate: these corpora
are clean markdown, and a real PDF with merged cells is where the HTML-serialiser
case will first appear.

**The default has not been flipped in this branch.** Turning it on changes
chunking for every installation on its next ingest, and every document already
indexed keeps the old shape until it is re-indexed — so a collection holds both
until then. That is a product call with a migration attached, and the one-line
change (`consts.ts`, plus the `.env.example` entries) is waiting on it rather
than assumed.

## Caveats

- **One adversarial corpus.** Five documents that are almost entirely wide
  tables. It says the mechanism works; it does not say how often customer
  documents look like this.
- **Two corpora of clean markdown.** Neither exercises a PDF whose tables
  Docling serialises as HTML, which is the case the all-or-nothing refusal
  exists for. The refusal has unit coverage; it has no field evidence.
- **Three runs each.** Enough for a median per the harness README, not enough
  to put an interval on it.

## Reproducing

```bash
# services, then apps/web and apps/worker against ragen_e2e with local storage
FEATURE_FLAG_TABLE_CHUNKS=1 npm run worker:dev     # or unset, for the baseline

npm run eval:benchmark -- --corpus ./evals/rag-benchmark/corpora/tabele-bilingual-v1
npm run eval:benchmark
```

Runs land in this directory as `…-rev<n>-run<m>`. Baseline: `rev1`, `rev1-run2`,
`rev1-run3` (table corpus) and `rev2-run5`…`run7` (general). Flag on:
`rev1-run4`…`run6` and `rev2-run2`…`run4`.
