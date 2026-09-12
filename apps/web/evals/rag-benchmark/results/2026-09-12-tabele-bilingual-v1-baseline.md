# Baseline — `tabele-bilingual-v1`, table chunking unchanged

**The number the tables spec is judged against.** Three runs on `main` with no
`FEATURE_FLAG_TABLE_CHUNKS` in the environment, which is every deployment today.

| Run                                                        | RAG         | Control (same model, no documents) |
| ---------------------------------------------------------- | ----------- | ---------------------------------- |
| [rev1](./2026-09-12-tabele-bilingual-v1-rev1.md)           | 10/18 (56%) | 0/18                               |
| [rev1-run2](./2026-09-12-tabele-bilingual-v1-rev1-run2.md) | 10/18 (56%) | 0/18                               |
| [rev1-run3](./2026-09-12-tabele-bilingual-v1-rev1-run3.md) | 8/18 (44%)  | 0/18                               |

**Median: 10/18 (56%).** The control scored zero in all three runs, which is
the corpus doing its job: every figure in it was invented, so nothing can be
answered from pre-training and the whole of the RAG column is retrieval.

Per the harness README, a single-run delta under about three cases is noise —
one case moved twice between these three runs with no instrument change.

## Which cases fail, and why that is the point

Seven questions failed in **all three** runs:

```
pl-cap-extensometer            en-cap-extensometer
en-rate-scale-verification-oob en-extensometer-cap-and-period
pl-ask-en-microscope-cap       en-ask-pl-roughness-oob
en-guard-false-premise
```

Six of the seven fail the same way, and the answers say so outright:

> „Niestety nie posiadam informacji o limicie zwrotu dla ekstensometru
> laserowego CD-2369. Dostarczony dokument … nie zawiera tej pozycji
> w udostępnionych fragmentach, **które kończą się na kodzie CD-1978**."

> "the specific hourly rate for scale verification is not mentioned. The
> context includes price list information for services such as CNC turning,
> CNC milling, and TIG welding" — **the first three rows of the table.**

The chunk that gets retrieved is the one holding the header and the opening
rows, because that is the piece that looks like a price list. The row actually
asked about sits fifteen chunks later in a piece that is bare numbers, and it
neither ranks nor, if it did, could be read: nothing in it says which column is
the cap and which is the list price.

That is the failure ADR-17 wrote down for CSV and deferred for everything else,
measured. The seventh, `pl-ask-en-microscope-cap`, is a different miss — the
answer gives the right figure without a currency, which matters only because a
twin Polish schedule quotes the same kind of figure in zloty.

## What this baseline does and does not license

It licenses a comparison: Phase C re-ingests this corpus with the flag on and
publishes the two columns side by side, **with the excision activation rate**,
because a flat result that came from excision never running is not the same
finding as a flat result that came from table chunks not helping.

It does not license reading the 56% as a quality figure for the product. The
corpus is adversarial by construction — five documents that are almost entirely
wide tables, every question aimed at a row in the last third of one. The
general-purpose number is
[`kolej-bilingual-v1`](./2026-09-12-kolej-bilingual-v1-rev2.md), and that
corpus cannot see this failure at all: its two tables are five rows each and
never get split.

## Stack

Recorded in each run's JSON, and identical across the three:
`gemini-3-flash-preview` answering, `gemini-2.5-flash` judging,
`mistral-small-3.2` rephrasing, `bge-multilingual-gemma2` at 3584 dimensions,
reranking on via Scaleway `qwen3-embedding-8b`, one multi-query variant,
Docling as the parser. Commit `bd8bd87a9`.
