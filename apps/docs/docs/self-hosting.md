---
sidebar_position: 2
---

# Self-hosting

Ragen runs on your infrastructure. This page gets an instance up and points out
the settings that matter more than the rest.

## What you need

- **Docker** and Docker Compose
- **Node.js 24.x** if you are running the apps outside containers
- Roughly 8 GB of RAM for the full stack. Document parsing is the hungry part.

A GPU is only needed if you intend to serve language models locally. Everything
else runs on CPU.

## Start the stack

The fastest path, if you haven't cloned the repo yet:

```bash
npx create-ragen-app my-ragen-app
```

[`create-ragen-app`](https://www.npmjs.com/package/create-ragen-app) clones the
repo, generates every secret it safely can, lets you paste a plain OpenAI or
Anthropic key instead of configuring an enterprise LLM provider, starts the
services listed under [What each service is for](#what-each-service-is-for) in
Docker, and runs `generate:types` plus the Prisma migrations for you — ending
at `cd my-ragen-app && npm run web:dev`. Requires Node.js 24+.
`--skip-docker`, `--skip-install` and `--yes` are available if you'd rather run
some of those steps yourself.

Already have the repo cloned, or want to do it by hand:

```bash
npm run ragen:up:full      # Postgres, Qdrant, Temporal, LiteLLM, Docling, Redis
npm install
npm run generate:types     # generate the Prisma client – nothing builds without it
npm run dev
```

`npm run generate:types` is not optional on a fresh checkout: the Prisma client
is generated from the schema and is not committed.

There is a smaller stack for when you only need to query existing knowledge
bases and not ingest new documents:

```bash
npm run ragen:up:app       # Postgres, Qdrant, LiteLLM only
```

### What each service is for

| Service | Needed for |
|---|---|
| Postgres | Everything |
| Qdrant | Vector search |
| LiteLLM | Every model call, chat and embeddings alike |
| Temporal | Asynchronous document ingestion |
| Docling | Document parsing and OCR, locally |
| Redis | Rate limiting only – optional |
| Presidio | Personal-data detection – optional, off by default |

## Settings that matter

Most configuration has a sensible default. These four do not, or default to
something a production install should change.

### Encryption is off until you configure a key provider

**Ragen starts normally with no key provider and stores message content
unencrypted.** That keeps local development simple and is wrong for production.

Set `ENCRYPTION_PROVIDER` to `scaleway`, `kms` or `local`, and supply the
matching key material. Verify it took effect: new threads should have
`encryptedDek` populated in the database.

### Document parsing is local, but it falls back

`DOCUMENT_PARSER=docling` is the default and parses on your own hardware. If
Docling fails, the worker falls back to loaders that send PDFs to an external
model.

For a deployment that must not transmit documents, set **`DOCLING_STRICT=1`**.
The ingest then fails instead of silently going off-site at exactly the moment
local parsing is unavailable.

### Storage defaults to the local filesystem

`STORAGE_PROVIDER=local` writes to `STORAGE_LOCAL_PATH` (`./data/storage` when
unset). **Mount a volume there**, or a restart loses every uploaded document,
and a multi-replica deployment will have replicas that cannot read each other's
files. The app logs a warning at startup if you use `local` with
`TARGET_ENV=production` or `staging`.

`STORAGE_PROVIDER=s3` works with any S3-compatible store – AWS, Cloudflare R2,
Scaleway Object Storage, MinIO, Ceph – by pointing `S3_ENDPOINT_URL` at it.
Credentials are `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`, not `AWS_`-prefixed
— those are reserved for real AWS Bedrock/KMS config, which a deployment can
then use at the same time as non-AWS S3 storage.

### The embedding model and the vector size must match

`EMBEDDINGS_MODEL` defaults to `bge-multilingual-gemma2`, which produces
**3584-dimension** vectors. `VECTOR_SIZE` must agree, or Qdrant rejects every
upsert. If you switch to `cohere-embed-multilingual-v3`, set `VECTOR_SIZE=1024`.

Changing the embedding model after documents are indexed makes the existing
vectors incompatible. Re-index everything when you change it.

## Minimum environment

```bash
DATABASE_URL="postgresql://postgres:<GENERATED_DB_PASSWORD>@localhost:55432/ragen"
DATABASE_DIRECT_URL="postgresql://postgres:<GENERATED_DB_PASSWORD>@localhost:55432/ragen"

QDRANT_URL=http://localhost:6333
LITELLM_PROXY_URL=http://localhost:4000
LITELLM_MASTER_KEY=<GENERATED_LITELLM_MASTER_KEY>

DEFAULT_MODEL_PROVIDER=litellm
DEFAULT_MODEL=gemini-3-flash-preview
EMBEDDINGS_MODEL=bge-multilingual-gemma2

BETTER_AUTH_SECRET=<random>
SESSION_AUTH_SECRET=<random>
```

Every `<GENERATED_...>` and `<random>` placeholder above is a sample —
production deployments must replace each one with its own unique, securely
generated secret, not a shared or predictable value.

For production, add an `ENCRYPTION_PROVIDER`, a persistent `STORAGE_LOCAL_PATH`
volume or S3 credentials, and `DOCLING_STRICT=1` if documents must not leave
your network.

## Feature flags

Off unless set to `1`:

| Flag | Effect |
|---|---|
| `FEATURE_FLAG_PII_MASKING` | Detect and mask personal data via Presidio. Needs two extra containers, which is why it is opt-in. |
| `FEATURE_FLAG_RERANKING` | Re-score retrieved chunks with a reranker before answering. Also needs provider credentials — `SCW_API_BASE` and `SCW_API_KEY` for the default Scaleway reranker — so it stays off on a default install. |
| `DOCLING_STRICT` | Fail ingestion rather than fall back to a parser that sends documents out. |

On unless set to `0`:

| Flag | Effect |
|---|---|
| `FEATURE_FLAG_DOC_SUMMARIES` | Generate a summary chunk per document at ingest. |

Multi-query expansion has no env flag. It is a per-organization setting
(default on) under **Organization → RAG settings**, alongside per-org toggles
for reranking and content moderation.

## Running without internet access

The architecture supports it: the model layer is decoupled behind LiteLLM, and
document parsing is already local. Two honest caveats.

**It is deployment work, not a flag.** Serving a capable model on your own
hardware means GPU capacity, and locally served open models generally answer
less well than commercial ones today. How much less depends on your documents
and your questions, so measure it on your own material before committing.

**One thing still reaches outward by default:** pulling container images at
install time. After that, outbound traffic can be cut, with updates delivered as
images to your internal registry.

Mail is optional. An internal SMTP server is the usual answer — point
`SMTP_HOST` at it and Ragen picks it up without further configuration. If you
would rather run with no mail at all, set `MAIL_PROVIDER=console`: nothing is
sent, and an administrator creates each account directly, handing over the
generated password out of band. Verification e-mails and invitation links are
the only things that need a transport, and neither is on that path.

Set `DOCLING_STRICT=1` for this configuration. Without it, a Docling failure
sends the document to an external model.

**[Open models on your own hardware](/docs/open-models)** is the how: which
server to run, how to wire vLLM or Ollama into LiteLLM, the four model settings
that stay cloud-hosted until you change them, and the calls that still reach
outward.

## The first account

The first person to open a fresh install is sent to a page that creates the
platform administrator — you choose the name, the organization name and the
password there. From then on that account can create the others.

If something required is still unconfigured, that same screen lists it by
environment-variable name and says what breaks without it, rather than failing
with a stack trace. An unreachable database is reported the same way.

## Verifying an install

```bash
curl http://localhost:3001/v1/healthcheck     # {"status":"ok"}
curl http://localhost:4000/v1/models          # models LiteLLM can actually reach
curl http://localhost:6333/collections        # Qdrant is up
```

If ingestion appears to hang, check the worker log first. Upload returns `200`
as soon as the file is stored – parsing happens afterwards, asynchronously, and
a parsing failure is only visible there and in the document's status.
