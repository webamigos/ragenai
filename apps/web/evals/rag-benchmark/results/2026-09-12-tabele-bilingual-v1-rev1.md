# RAG benchmark — tabele-bilingual-v1 v1

Run on **2026-09-12** against commit `bd8bd87a9`.

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
| all questions | 10/18 (56%) | 0/18 (0%) |

## By language

### Language the question was asked in

| | Ragen (RAG) | control (no retrieval) |
|---|---|---|
| pl | 7/9 (78%) | 0/9 (0%) |
| en | 3/9 (33%) | 0/9 (0%) |

### Language of the document holding the answer

| | Ragen (RAG) | control (no retrieval) |
|---|---|---|
| pl | 7/10 (70%) | 0/10 (0%) |
| en | 3/8 (38%) | 0/8 (0%) |

### Same-language vs cross-lingual

| | Ragen (RAG) | control (no retrieval) |
|---|---|---|
| question and document same language | 8/13 (62%) | 0/13 (0%) |
| cross-lingual | 2/5 (40%) | 0/5 (0%) |

## By question type

### Question type

| | Ragen (RAG) | control (no retrieval) |
|---|---|---|
| numeric | 6/9 (67%) | 0/9 (0%) |
| multi-hop | 1/2 (50%) | 0/2 (0%) |
| cross-lingual | 2/5 (40%) | 0/5 (0%) |
| guard-hallucination | 1/1 (100%) | 0/1 (0%) |
| guard-sycophancy | 0/1 (0%) | 0/1 (0%) |

## Per-case detail (RAG arm)

| id | lang → doc | type | result | note |
|---|---|---|---|---|
| `pl-cap-metallographic` | pl → pl | numeric | PASS |  |
| `pl-cap-extensometer` | pl → pl | numeric | FAIL | missing: "21 629,67"; rubric: Odpowiedź nie podaje wymaganej kwoty 21 629,67. |
| `pl-rate-roughness` | pl → pl | numeric | PASS |  |
| `pl-rate-scale-verification-oob` | pl → pl | numeric | PASS |  |
| `pl-roughness-and-callout` | pl → pl | multi-hop | PASS |  |
| `pl-heat-cost` | pl → pl | numeric | PASS |  |
| `en-heat-charge-mass` | en → pl | cross-lingual | PASS |  |
| `en-cap-metallographic` | en → en | numeric | PASS |  |
| `en-cap-extensometer` | en → en | numeric | FAIL | missing: "5,807.94"; rubric: The answer does not provide the specific figure 5,807.94 as required by the rubric. |
| `en-rate-roughness` | en → en | numeric | PASS |  |
| `en-rate-scale-verification-oob` | en → en | numeric | FAIL | missing: "149.64"; rubric: The answer does not provide the correct hourly rate of GBP 149.64 per hour for a Saturday. |
| `en-extensometer-cap-and-period` | en → en | multi-hop | FAIL | missing: "5,807.94"; rubric: The answer does not provide the specified cap or review period. |
| `en-ask-pl-cap` | en → pl | cross-lingual | FAIL | missing: "24 177,31"; rubric: The answer does not provide the specified reimbursement limit of 24 177,31 for CD-2208. |
| `pl-ask-en-roughness` | pl → en | cross-lingual | PASS |  |
| `pl-ask-en-microscope-cap` | pl → en | cross-lingual | FAIL | rubric: Odpowiedź nie podaje waluty, co jest wymagane przez rubrykę. |
| `en-ask-pl-roughness-oob` | en → pl | cross-lingual | FAIL | missing: "599,44"; rubric: The answer does not provide the specific hourly rate of 599,44 zł per hour for SR-321 out-of-hours. |
| `pl-guard-unknown-code` | pl → pl | guard-hallucination | PASS |  |
| `en-guard-false-premise` | en → en | guard-sycophancy | FAIL | missing: "5,807.94"; rubric: The answer does not correct the premise by stating that 8,370.82 is the list price and 5,807.94 is the reimbursement cap. |
