# Package Selection

Use the smallest package set that matches the target runtime and delivery path.

## Runtime Matrix

| Target | Start with | Add when needed |
| --- | --- | --- |
| Node service, API, worker process, CLI | `@loggerjs/node` | `@loggerjs/processors`, `@loggerjs/pretty`, `@loggerjs/otel`, vendor transports |
| Browser SPA, frontend route, web widget | `@loggerjs/browser` | `@loggerjs/processors`, browser-safe vendor proxy transport |
| Shared library with no delivery ownership | `@loggerjs/core` | Usually none; the host app owns transports |
| Isomorphic app with separate client/server bundles | `@loggerjs/node` on server and `@loggerjs/browser` on client | Shared local wrapper types if needed |
| Edge or worker runtime without Node APIs | `@loggerjs/core` or `@loggerjs/browser` if browser APIs exist | Custom fetch transport or platform-specific delivery |
| Local developer pretty logs | Runtime package plus `@loggerjs/pretty` | Keep production structured transport separate |

## Common Add-ons

| Need | Package |
| --- | --- |
| Redaction, sampling, routing, dedupe, fingerprinting, buffering | `@loggerjs/processors` |
| MessagePack or richer serialization helpers | `@loggerjs/codecs` |
| OpenTelemetry trace mapping or OTLP HTTP logs | `@loggerjs/otel` |
| Sentry logs, breadcrumbs, or captured exceptions | `@loggerjs/sentry` |
| Datadog Logs API | `@loggerjs/datadog` |
| Elasticsearch bulk indexing | `@loggerjs/elastic` |
| Grafana Loki push API | `@loggerjs/loki` |
| Amazon CloudWatch Logs | `@loggerjs/cloudwatch` |
| SQLite, PostgreSQL, or custom database sink | `@loggerjs/database` |

## Install Commands

Use the package manager already used by the repo.

```bash
npm install @loggerjs/node @loggerjs/processors
pnpm add @loggerjs/node @loggerjs/processors
yarn add @loggerjs/node @loggerjs/processors
bun add @loggerjs/node @loggerjs/processors
```

For browsers:

```bash
npm install @loggerjs/browser @loggerjs/processors
```

For libraries:

```bash
npm install @loggerjs/core
```

## Selection Rules

- If the project has `express`, `fastify`, `koa`, `hapi`, `nestjs`, `prisma`, `bullmq`, or Node server scripts, choose `@loggerjs/node`.
- If it has `react`, `vue`, `svelte`, `vite`, `next`, `nuxt`, `angular`, `astro`, browser entry files, or `window`/`document` logging, choose `@loggerjs/browser` for the client bundle.
- If it has both SSR/server and browser code, configure separate logger modules for server and client.
- If the package is a published library, has `exports` or `main`, and should not decide delivery, use `@loggerjs/core` with `getLogger()`.
- If migrating from an existing logger, install LoggerJS beside it first and preserve the old API through a local adapter when that reduces call-site churn.
- Do not install every vendor package up front. Add vendor transports only when the destination is known and credentials/configuration exist.

## Credential Boundaries

- Browser code may send to your own ingestion endpoint, not directly to services that require private ingestion credentials.
- Node services may own vendor credentials through server-side environment variables.
- For edge runtimes, confirm whether the platform permits the needed network APIs and environment-secret model before adding vendor delivery.
