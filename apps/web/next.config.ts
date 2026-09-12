// Shared local configuration from the repository root. Real environment
// variables and this app's own .env files both win over it — see the
// function's own comment for why and for the ADR-29 history.
import '../../scripts/load-root-env.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// The app lives at apps/web but its dependencies are hoisted to the monorepo
// root. Without this, `output: 'standalone'` traces from apps/web and omits
// everything above it, producing an image that builds and then fails to start.
const monorepoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone' as const,
  outputFileTracingRoot: monorepoRoot,
  reactStrictMode: true,

  async headers() {
    return [
      {
        // CORS headers for chatbot widget JS — must be accessible cross-origin
        source: '/chatbot-widget.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
      {
        // Security headers for all routes
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(self), geolocation=()',
          },
          ...(process.env.NODE_ENV === 'production'
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]
            : []),
        ],
      },
    ];
  },

  serverExternalPackages: [
    'pdf-parse',
    'pino',
    'pino-pretty',
    'thread-stream',
    '@hyzyla/pdfium',
    '@aws-sdk',
    '@prisma/adapter-pg',
    '@opentelemetry/api',
    '@opentelemetry/api-logs',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/resources',
    '@opentelemetry/instrumentation',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/exporter-metrics-otlp-http',
    '@opentelemetry/exporter-logs-otlp-http',
    '@opentelemetry/instrumentation-http',
    '@opentelemetry/instrumentation-pg',
    '@prisma/instrumentation',
  ],

  transpilePackages: ['better-auth'],

  /**
   * There is no `webpack` block here, and that is deliberate.
   *
   * One lived here and configured five things: a `NormalModuleReplacementPlugin`
   * swapping `serverLogger` for `clientLogger`, a second redirecting
   * `generated/prisma/client` to `generated/prisma/browser`, a `pdfjs-dist`
   * alias, `externals` for better-auth and pino-pretty, and `resolve.fallback`
   * stubs for a dozen node builtins. **None of it ever ran**: apps/web builds
   * with bare `next dev` / `next build` on Next 16, where Turbopack is the
   * bundler and a `webpack` key is never invoked — no warning, green build.
   *
   * Each item was checked against a real build before being removed, and none
   * is needed (`docs/lessons/a-webpack-config-block-is-inert-under-turbopack.md`):
   *
   * - **The logger swap.** `app/lib/utils/logger/index.ts` picks at *runtime*
   *   on `typeof window`, so no build-time swap is required. No client chunk
   *   contains pino-pretty or serverLogger's own throw message.
   * - **The Prisma redirect.** Client components already import
   *   `@/generated/prisma/browser` directly — 53 files do. One that imported
   *   `@/generated/prisma/client` instead would fail the build, so the rule is
   *   self-enforcing; `tests/architecture/client-bundles-stay-browser-safe.test.ts`
   *   exists because that failure is a Turbopack panic naming neither the file
   *   nor the import.
   * - **`externals`.** It listed `better-auth`, which 62 client entry points
   *   legitimately use through `better-auth/react`. Had it run, it would have
   *   broken them.
   * - **The node-builtin fallbacks.** No `node:` builtin appears in any client
   *   chunk. `serverExternalPackages` above keeps the server-only packages off
   *   the client, and it is real config rather than a dead function.
   *
   * If something here does need bundler configuration later, it goes in a
   * top-level `turbopack` key — not in a `webpack` function, which this app
   * does not run.
   */
};

export default withNextIntl(nextConfig);
