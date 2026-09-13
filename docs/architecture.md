# Architecture

Split out of `README.md` so the README can introduce the product rather than
document it. The README's "Architecture at a glance" section links here.

For the rules a change has to respect — tenant scoping, the two role
hierarchies, the feature-module conventions — see [`../AGENTS.md`](../AGENTS.md),
which is the canonical brief for contributors and coding agents alike.

## Monorepo layout

This is an npm-workspaces monorepo (`apps/*` + `packages/*`):

```
.
├── apps/
│   ├── web/                      # The Next.js app (ADR-29 moved it off the root)
│   ├── api/                      # NestJS public API
│   ├── admin/                    # Platform admin panel
│   ├── worker/                   # Temporal document-ingest worker
│   └── docs/                     # Docusaurus documentation site (ADR-30)
├── packages/
│   ├── db/                       # Prisma client singleton
│   ├── rag-core/                 # Vector contract shared by app, api & worker:
│   │                             #   BM25 encoder, VECTOR_SIZE, vector names,
│   │                             #   default embedding model (ADR-26)
│   ├── platform-contracts/       # Values every app must resolve identically:
│   │                             #   model catalogue, feature flags, connector
│   │                             #   metadata, tenant-scope map (ADR-33)
│   ├── storage/                  # File storage: local filesystem by default,
│   │                             #   any S3-compatible store opt-in (ADR-27)
│   ├── litellm-client/           # Proxy admin client (ADR-34)
│   ├── vault-client/             # HMAC-signed token-vault client (ADR-32)
│   ├── crypto/                   # Envelope encryption: the KeyProvider
│   │                             #   interface, its Scaleway/AWS/local
│   │                             #   implementations, AES-256-GCM helpers
│   ├── env/                      # Typed env contract, composed per app
│   │                             #   from shared fragments (ADR-37)
│   ├── observability/            # OTel logger + span helper (ADR-28)
│   └── eslint-config/            # One flat config, three entry points
└── prisma/schema.prisma          # One schema, a generator block per app
```

`packages/rag-core` exists because the worker writes the vectors the app queries.
If the two sides disagree on the tokenizer, the hash, or the dimensionality,

Supporting services — LiteLLM, Docling, Presidio and the OTel collector — live
in `infra/`; see [`../infra/README.md`](../infra/README.md). Each carries its
own `railway.toml`, so moving one means changing that Railway service's root
directory.

## Inside `apps/web/src`

Inside `apps/web/src/`:

```
apps/web/src/
├── app/                          # Next.js App Router
│   ├── [locale]/                 # Locale-prefixed routes (en, pl)
│   │   ├── (panel)/              # Authenticated app (threads, settings, documents)
│   │   ├── (auth)/               # Sign-in, sign-up, forgot password
│   │   └── public/               # Public assistant chat widgets
│   ├── api/
│   │   ├── v1/                   # Internal API endpoints (called by apps/api)
│   │   │   └── chat/             # RAG chat endpoint (SSE + JSON)
│   │   ├── threads/              # Internal thread streaming endpoints
│   │   └── ...
│   ├── actions/                  # Server actions
│   └── components/               # UI components organized by feature
│
├── features/                     # Domain feature modules (CQRS pattern)
│   ├── assistants/               # Assistant mode types
│   ├── connectors/               # External connectors (Google Drive, etc.)
│   ├── documents/                # Document & file management
│   ├── messages/                 # Chat messages
│   ├── onboarding/               # User onboarding flow
│   ├── organizations/            # Organizations, settings, API keys
│   ├── projects/                 # Projects & instructions
│   ├── subscriptions/            # Subscription management
│   ├── threads/                  # Chat threads & SSE events
│   └── users/                    # User metadata
│
├── libs/                         # Shared libraries
│   ├── llm/                      # Multi-provider chat completion & embeddings
│   ├── chains/                   # RAG chains (basic-rag, conversation, PDF processing)
│   ├── vector-store/             # Qdrant, Meilisearch & Supabase vector store clients
│   ├── reranker/                 # Scaleway rerank (default) or Bedrock Cohere (post-retrieval)
│   ├── document-loaders/         # PDF, EPUB, DOCX, Markdown, SRT, CSV, XLSX, Image, URL parsing
│   ├── db/                       # Prisma client singleton (@ragenai/prisma-client)
│   ├── temporal/                 # Temporal.io client
│   ├── payments/                 # Stripe integration
│   ├── mcp/                      # MCP client for external tool servers
│   ├── ragen-vault/              # Wiring for @ragenai/vault-client (env + logger)
│   ├── sse/                      # Server-Sent Events for streaming
│   └── common-ui/                # Shared UI utilities (@ragenai/common-ui)
│
├── store/                        # Redux Toolkit (client UI state)
├── generated/prisma/             # Generated Prisma client (gitignored)
└── i18n/                         # Internationalization config
```

### What each `libs/` module is for

The tree above is the map; this is what the modules actually do.

- `llm/` — chat completion + embeddings factories through LiteLLM (`@ai-sdk/openai` `.chat()`)
- `litellm/` — proxy client: dynamic model fetching, health checks
- `chains/` — RAG chains (see `basic-rag/`)
- `vector-store/` — Qdrant (the only supported backend), plus Meilisearch and Supabase clients implementing `VectorStoreClient` that are **not connected at the write end** — ingest writes to Qdrant unconditionally, so selecting either returns nothing. See [ADR-31](adrs/31-only-qdrant-is-a-supported-vector-store.md).
- `reranker/` — Scaleway `/v1/rerank` (default) or Bedrock Cohere Rerank v3.5, selected by `RERANK_PROVIDER`
- `document-loaders/` — PDF, EPUB, DOCX, Markdown, SRT, CSV, XLSX, Image, URL parsing
- `db/` — Prisma singleton
- `temporal/` — Temporal.io client for async document workflows
- `payments/` — Stripe
- `mcp/` — MCP client via `@ai-sdk/mcp`
- `ragen-vault/` — wiring for `@ragenai/vault-client` (reads this app's env, passes its logger). The client and the HMAC signing live in the package — do not add a fourth copy ([ADR-32](adrs/32-token-vault-and-mcp-stay-separate.md)).
- `crypto/` — **only** `public-link-token.ts`, which HMAC-signs a share token. Envelope encryption for thread messages and document content lives in `@ragenai/crypto`; a second copy here is what [`thread-encryption.md`](thread-encryption.md) and the architecture guard exist to prevent.
- `monitoring/` — OTel helpers: `withSpan()` for manual business-logic spans (mirrors ragen-api's), plus the logs-API bridge. No-op when no OTLP endpoint is configured.
- `sse/` — Server-Sent Events streaming
- `common-ui/` — shared UI components and utilities (aliased `@ragenai/common-ui`)

`libs/tui` was a vendored Tailwind UI component set, aliased `@ragenai/tui`.
[ADR-41](adrs/41-one-component-library-shadcn.md) removed it: what it held is
either `components/ui` (shadcn) now or written against this repository's token
layer under `common-ui`. No path is left that restricts redistribution, but
`components/ui` is copied MIT code whose notice has to travel with it — see
[`open-core-boundary.md`](open-core-boundary.md).

## Feature modules

Each feature module in `src/features/` follows a CQRS (Command Query Responsibility Segregation) pattern:

```
features/{feature}/
├── contracts/          # Types, DTOs, schemas
├── constants/          # Feature-specific constants
├── services/
│   ├── queries/        # Read operations (get*Query)
│   └── commands/       # Write operations (*Command)
└── utils/              # Feature-specific utilities
```

- **Queries** return data directly
- **Commands** perform mutations and return results or `OperationResult<T>`
- All server-side functions use `'use server'` directive where needed

## Application architecture

### Routing

Routes are locale-prefixed (`/en/...`, `/pl/...`) via `next-intl`. Middleware handles i18n routing and session cookie checks. Auth verification happens in server components/layouts.

### API

The public API is served by **`apps/api`** (NestJS, port 3001) — a workspace in this monorepo since [ADR-21](adrs/21-monorepo-and-api-decoupling.md); the standalone `ragen-api` repo is archived. It owns the notifications, messages, projects, connectors, documents and threads domains directly, and apps/web's Server Actions call its session-authenticated `internal/*` routes. apps/web still exposes internal endpoints at `/api/v1/` protected by a shared secret (`INTERNAL_API_SECRET`) and context headers (`x-org-id`, `x-user-id`, `x-project-id`).

The shared secret travels in an `x-internal-secret` header and is compared
timing-safely. Setting `IS_API_MODE=1` puts apps/web in API-only mode, which
rewrites `/v1` to `/api/v1`.

API keys use an opaque format (`sk-<keyId>.<secret>`) with no embedded context (see [ADR-13](adrs/13-opaque-api-keys.md)). Keys are stored in ragen-token-vault; the database only holds `maskedValue`, `isActive`, and `lastUsedAt`.

### Auth

Better Auth with Prisma adapter + `admin` and `organization` plugins (with `createAccessControl`). On user creation, a hook auto-creates an organization, internal organization, and default project. Dual org system: Better Auth `Organization` for membership + Ragen `InternalOrganization` for app data (projects, API keys, subscriptions).

Two role hierarchies:
- **App-level** (`User.role`): `'admin'` (superadmin) vs `'user'` — platform-wide access
- **Org-level** (`Member.role`): `'owner'`, `'admin'`, `'member'` — per-organization permissions

Centralized in `src/lib/auth-access-control.ts` (client-safe checks) and `src/lib/auth-guards.ts` (server-side guards).

### Settings & Admin Navigation

Ragen has **three** administrative surfaces. Two live in `apps/web` and are described below; the third is a separate application, `apps/admin`, covered in the next section. The split is by scope, not by subject — see [ADR-35](adrs/35-two-admin-surfaces-split-by-scope.md).

The two inside `apps/web` are intentionally split across separate routes and navigation trees.

**`/settings/*` — user-level preferences.** Three pages today: General, Account, Connectors. All authenticated users see them. The left-side nav is driven by a declarative registry at `src/features/settings/registry.ts`. Each entry describes one page (`id`, `path`, `labelKey`, `icon` id, `order`, `visibility` rules). The layout resolves the caller's roles on the server side, filters the registry via the pure `filterSettingsPages()` helper in `src/features/settings/filter.ts`, and passes only the visible pages to the client-side `SettingsNav` component.

**`/organization/*` — org-admin and app-admin tools.** The org layout gates the whole subtree to org admins (and app admins) and renders `OrganizationNav`. Pages include Organization (members), Assistant settings, RAG settings, Subscription, Teams, API Keys, Security, AI Usage, Disk Usage, Audit Logs, Chatbots. These pages are **not** part of `settingsRegistry` — they belong to a different navigation tree with different access rules and layout.

The sidebar user-menu dropdown exposes three shortcuts into the admin tools (AI Usage, Disk Usage, Audit Logs) so org admins don't have to open the Organization section to reach them.

**Adding a user-level settings page:** create the page under `src/app/[locale]/(panel)/settings/<id>/page.tsx`, add the translation key under `settings-page.nav` to every locale file in `src/app/messages/` (see `apps/web/src/app/config.ts` for the full list), then append one entry to `settingsRegistry`. The registry handles role gating, sort order, and active-link highlighting automatically.

**Adding an org-admin page:** create it under `src/app/[locale]/(panel)/organization/<id>/page.tsx` and add a corresponding entry to the `navItems` array in `OrganizationNav`. The `/organization` layout handles access control for you.

Icons in `settingsRegistry` are identified by a stable string (`'cog' | 'user' | 'puzzle'`) and resolved to heroicon components inside `SettingsNav`. Component references can't be serialized across the RSC boundary, so passing them from the server layout would crash at render — add new icon ids to the client-side `ICONS` map when extending the registry.

Theme switching (Light/Dark/System) is available in Settings > General via `next-themes`.

### MCP Connectors

Each external integration (Google Calendar/Drive/Analytics/Ads, Gmail, HubSpot, ClickUp, Slack, Fireflies, WooCommerce) is declared as a self-contained manifest under `src/features/connectors/providers/<name>.ts`. A manifest bundles everything that provider needs to exist: display metadata, auth type (`oauth | api_key_bearer | api_key_custom_header | external_mcp`), MCP server URL, scopes, OAuth client credentials (read from env), and the provider-specific system-prompt fragment that the chat adds when the connector is enabled.

`src/features/connectors/providers/registry.ts` aggregates the manifests into `PROVIDER_REGISTRY: Record<McpConnectorProvider, ProviderDefinition>` — the `Record` shape gives a compile-time guarantee that every value in the Prisma `McpConnectorProvider` enum has a manifest. Add an enum value without a manifest and TypeScript fails the build. The same file exposes `PROVIDER_LIST` (server-side, full manifests), `getProvider(id)`, `toPublicProviderDto(def)` and `PUBLIC_PROVIDER_LIST`.

**Client-safe DTO.** `toPublicProviderDto()` strips everything a browser must not see — OAuth client secret/id, function-valued `systemPromptFragment`, and server-only auth config (`useUserScope`, `headerName`, `mcpServerUrlPath`). Settings > Connectors consumes `PUBLIC_PROVIDER_LIST` so the full manifest never crosses the RSC boundary. Regression tests in `providers/__tests__/registry.test.ts` iterate every registered provider and fail the build if any sensitive field leaks through the DTO.

**System prompt builder.** `buildMcpContext(providerIds, timeZone, now)` in `providers/system-prompt.ts` walks the registry and concatenates the fragment for every enabled provider. Static strings are inlined; function-valued fragments (e.g. Google Calendar, which needs the caller's `timeZone`) are invoked with the context before inclusion.

**Adding a new MCP provider:** add the enum value to `prisma/schema.prisma` (regenerate the client), create `src/features/connectors/providers/<id>.ts` with the `ProviderDefinition`, and register it in `PROVIDER_REGISTRY`. The `Record<McpConnectorProvider, …>` type forces you to do all three — missing any one breaks `tsc`. No touch-ups needed across scattered files.

Old import paths (`CONNECTOR_PROVIDERS`, `getProviderDefinition` from `src/features/connectors/constants/providers.ts`; `buildMcpContext` from `src/libs/mcp/provider-instructions.ts`) remain as thin re-exports so existing callers keep working.

### State Management

- **Redux Toolkit** (`src/store/`): client UI state (sidebar, assistant config, threads list, voice). Typed hooks live in `src/store/hooks.ts` — use those, not the bare `useDispatch`/`useSelector`.
- **React Context**: `AssistantSettingsContext`, `FilesContext`, `OnboardingContext`, `SearchThreadsContext`
- **Server state**: Prisma queries in server components and server actions
