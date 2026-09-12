# RAG benchmark — kolej-bilingual-v1 v2

Run on **2026-09-12** against commit `d975ba4f8`.

Every figure in this corpus was invented for it and exists nowhere else, so a
correct answer is evidence that retrieval worked rather than that the model
remembered. The control column is the same model answering the same question
with no documents attached — the floor the pipeline has to beat.

## Stack under test

| | |
|---|---|
| chat model | `gemini-3-flash-preview` |
| judge model | `gemini-2.5-flash` |
| rephrase model | `mistral-small-3.2` |
| embeddings | `bge-multilingual-gemma2` (3584-dim) |
| reranking | on — `scaleway` / `qwen3-embedding-8b` |
| multi-query variants | 1 (default) |

## Overall

### All questions

| | Ragen (RAG) | control (no retrieval) |
|---|---|---|
| all questions | 19/24 (79%) | — |

## By language

### Language the question was asked in

| | Ragen (RAG) | control (no retrieval) |
|---|---|---|
| pl | 9/12 (75%) | — |
| en | 10/12 (83%) | — |

### Language of the document holding the answer

| | Ragen (RAG) | control (no retrieval) |
|---|---|---|
| pl | 10/12 (83%) | — |
| en | 9/12 (75%) | — |

### Same-language vs cross-lingual

| | Ragen (RAG) | control (no retrieval) |
|---|---|---|
| question and document same language | 16/16 (100%) | — |
| cross-lingual | 3/8 (38%) | — |

## By question type

### Question type

| | Ragen (RAG) | control (no retrieval) |
|---|---|---|
| factual | 2/2 (100%) | — |
| numeric | 6/6 (100%) | — |
| comparative | 2/2 (100%) | — |
| multi-hop | 2/2 (100%) | — |
| guard-hallucination | 2/2 (100%) | — |
| guard-sycophancy | 2/2 (100%) | — |
| cross-lingual | 3/8 (38%) | — |

## Per-case detail (RAG arm)

| id | lang → doc | type | result | note |
|---|---|---|---|---|
| `pl-mono-refund-pct` | pl → pl | factual | PASS |  |
| `pl-mono-refund-deadline` | pl → pl | numeric | PASS |  |
| `pl-mono-baggage-weight` | pl → pl | numeric | PASS |  |
| `pl-mono-refund-threshold` | pl → pl | numeric | PASS |  |
| `pl-mono-compare-deadlines` | pl → pl | comparative | PASS |  |
| `pl-mono-multihop-bazyliszek` | pl → pl | multi-hop | PASS |  |
| `pl-mono-guard-hallucination` | pl → pl | guard-hallucination | PASS |  |
| `pl-mono-guard-sycophancy` | pl → pl | guard-sycophancy | PASS |  |
| `en-mono-refund-pct` | en → en | factual | PASS |  |
| `en-mono-refund-deadline` | en → en | numeric | PASS |  |
| `en-mono-baggage-weight` | en → en | numeric | PASS |  |
| `en-mono-refund-threshold` | en → en | numeric | PASS |  |
| `en-mono-compare-deadlines` | en → en | comparative | PASS |  |
| `en-mono-multihop-cockatrice` | en → en | multi-hop | PASS |  |
| `en-mono-guard-hallucination` | en → en | guard-hallucination | PASS |  |
| `en-mono-guard-sycophancy` | en → en | guard-sycophancy | PASS |  |
| `xl-pl2en-refund-pct` | pl → en | cross-lingual | FAIL | missing: "62"; must not contain: "87"; rubric: The answer does not state 62% from the English Wolfsbane document. |
| `xl-pl2en-baggage-liability` | pl → en | cross-lingual | FAIL | must not contain: "1 480" |
| `xl-pl2en-delay-threshold` | pl → en | cross-lingual | PASS |  |
| `xl-pl2en-bike-fare` | pl → en | cross-lingual | FAIL | missing: "3.40"; must not contain: "9,80"; rubric: The answer does not state 3,40 EUR as the cost for Wolfsbane Interurban Rail. |
| `xl-en2pl-refund-pct` | en → pl | cross-lingual | PASS |  |
| `xl-en2pl-baggage-liability` | en → pl | cross-lingual | PASS |  |
| `xl-en2pl-min-payout` | en → pl | cross-lingual | FAIL | missing: "31"; must not contain: "27"; rubric: The answer does not state that compensation below 31 zł is not paid out. |
| `xl-en2pl-bike-fare` | en → pl | cross-lingual | FAIL | must not contain: "3.40"; rubric: The answer includes the EUR 3.40 figure, which the rubric explicitly forbids. |
