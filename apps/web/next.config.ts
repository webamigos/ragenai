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

  webpack: (
    config: any,
    { isServer, webpack }: { isServer: boolean; webpack: any },
  ) => {
    // There was a `pdfjs-dist` alias here for react-pdf, pointing at
    // `apps/web/node_modules/pdfjs-dist/legacy/build/pdf.js`. That file does
    // not exist, for two independent reasons — `pdfjs-dist` is hoisted to the
    // monorepo root, and pdfjs-dist@5 ships only `.mjs`, so there is no
    // `pdf.js` in `build/` or `legacy/build/` — and it had no effect either
    // way, because this whole function is inert: apps/web runs bare
    // `next dev` / `next build` on Next 16, where Turbopack is the bundler and
    // a `webpack` key is never called. Removed rather than corrected: nothing
    // needs it. Turbopack resolves `pdfjs-dist` normally and emits the worker
    // from `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)`
    // as a static asset, which is what the viewer actually relies on.

    if (!isServer) {
      // Replace serverLogger with clientLogger on client-side
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /serverLogger/,
          (resource: any) => {
            resource.request = resource.request.replace(
              /serverLogger/,
              'clientLogger',
            );
          },
        ),
      );

      // Prevent server-only modules from being bundled on client-side
      config.externals = config.externals || [];
      config.externals.push(
        'better-auth',
        'better-auth/adapters/prisma',
        'better-auth/plugins',
        'pino-pretty',
      );

      config.resolve.alias = {
        ...config.resolve.alias,
        '@/app/lib/utils/logger/serverLogger':
          '@/app/lib/utils/logger/clientLogger',
      };

      // Redirect Prisma generated client to browser-safe version (no Node.js imports)
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /generated\/prisma\/client/,
          (resource: any) => {
            resource.request = resource.request.replace(
              /generated\/prisma\/client/,
              'generated/prisma/browser',
            );
          },
        ),
      );

      config.resolve.fallback = {
        ...config.resolve.fallback,
        child_process: false,
        fs: false,
        inspector: false,
        tls: false,
        net: false,
        async_hooks: false,
        worker_threads: false,
        dns: false,
        module: false,
      };
    }

    return config;
  },
};

export default withNextIntl(nextConfig);
