---
name: loggerjs
description: Use LoggerJS in JavaScript or TypeScript projects. Trigger when adding structured logging, choosing LoggerJS packages for Node.js, browser, worker, edge, CLI, or library code, configuring transports, integrations, processors, codecs, OpenTelemetry or vendor delivery, migrating from console, pino, winston, loglevel, debug, or other loggers, or troubleshooting LoggerJS logging behavior.
---

# LoggerJS

## Overview

Use this skill to integrate LoggerJS into a real JavaScript or TypeScript codebase with the smallest correct package set, a runtime-appropriate logger module, production guardrails, and repo-local validation.

LoggerJS is an isomorphic structured logging toolkit: a zero-dependency core plus platform packages for Node.js, browsers, workers, edge runtimes, transports, integrations, processors, codecs, and vendor delivery.

## Workflow

1. Inspect the target project before changing code.
   - Run `node <skill-dir>/scripts/inspect-loggerjs-project.mjs <project-dir>` when the skill files are available locally.
   - Otherwise inspect `package.json`, lockfiles, framework config, existing logger dependencies, and current logging call sites manually.
2. Choose the minimum package set.
   - Read `references/package-selection.md` when runtime, package, or vendor choice is not obvious.
   - Prefer `@loggerjs/node` for Node services/CLIs, `@loggerjs/browser` for frontend apps, and `@loggerjs/core` for runtime-neutral libraries.
3. Add one centralized logger module per runtime boundary.
   - Keep app code importing from the local logger module, not directly from many LoggerJS package paths.
   - Platform packages re-export core APIs, so start with one platform package unless a vendor or processor package is needed.
4. Configure production safety before broad rollout.
   - Read `references/production-checklist.md` before adding browser delivery, vendor delivery, persistent queues, or automatic capture.
   - Add redaction/privacy processors before transports that leave the process.
   - Never place vendor API keys, long-lived tokens, or private ingestion credentials in browser code.
5. Migrate incrementally.
   - Read `references/migration.md` when replacing console, pino, winston, loglevel, debug, consola, or a custom wrapper.
   - Preserve existing call-site semantics first, then improve structure, context, and delivery.
6. Validate with the target repo's own gates.
   - Run the package manager install command if dependencies changed.
   - Run typecheck/build/tests or the closest project-local equivalents.
   - For browser apps, verify no secret-bearing environment variables are bundled client-side.

## Reference Map

- `references/package-selection.md`: package matrix, runtime detection, install commands, and vendor package choices.
- `references/runtime-recipes.md`: minimal Node, browser, library, local pretty, OpenTelemetry, and Sentry recipes.
- `references/production-checklist.md`: privacy, reliability, lifecycle, performance, and browser credential guardrails.
- `references/migration.md`: incremental migration patterns from existing loggers.
- `references/troubleshooting.md`: common missing-log, duplicate-log, browser, flush, codec, and delivery failures.

Use the public docs when exact API details or broader context are needed:

- Concise map: `https://jskits.github.io/loggerjs/llms.txt`
- Full context: `https://jskits.github.io/loggerjs/llms-full.txt`
- Package/API reference: `https://jskits.github.io/loggerjs/reference/`

## Implementation Rules

- Prefer TypeScript examples and ESM imports.
- Keep LoggerJS setup in a small module such as `src/logger.ts`, `src/lib/logger.ts`, or the framework's existing observability/logging module.
- Keep disabled-level hot paths cheap: avoid eager string interpolation, `JSON.stringify`, expensive context builders, or stack parsing before the logger level gate.
- Use lazy messages or structured data for expensive values.
- Use processors only when event-level behavior is needed. No-processor record paths are the fastest path.
- Treat integrations as opt-in automatic capture. Add only the platform hooks the app actually needs.
- Treat codecs as transport-owned. Do not pre-stringify records in application code before LoggerJS sees them.
- Pair remote transports with bounded batching, retry/backoff, circuit-breakers, or offline queues where appropriate.
- Make `flush()` part of controlled shutdown, tests that assert delivery, CLI exit paths, and requestless scripts.
- In libraries, prefer `getLogger(["package-or-feature"])`; do not force host applications to configure transports.

## Minimal Patterns

Node service:

```ts
import { captureProcessIntegration, createLogger, stdoutTransport } from "@loggerjs/node";
import { redactProcessor } from "@loggerjs/processors";

export const logger = createLogger({
  name: "api",
  level: process.env.LOG_LEVEL ?? "info",
  tags: { service: "api", env: process.env.NODE_ENV ?? "dev" },
  processors: [redactProcessor()],
  transports: [stdoutTransport()],
  integrations: [captureProcessIntegration()],
});
```

Browser app:

```ts
import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureFetchIntegration,
  createLogger,
  pageLifecycleIntegration,
} from "@loggerjs/browser";
import { redactProcessor } from "@loggerjs/processors";

export const logger = createLogger({
  name: "web",
  level: "info",
  processors: [redactProcessor()],
  transports: [
    browserHttpTransport({
      url: "/api/logs",
      maxBatchSize: 20,
      flushIntervalMs: 1500,
      useBeaconOnPageHide: true,
    }),
  ],
  integrations: [
    captureBrowserErrorsIntegration(),
    captureFetchIntegration(),
    pageLifecycleIntegration(),
  ],
});
```

Library code:

```ts
import { getLogger } from "@loggerjs/core";

const logger = getLogger(["my-library"]);

export function doWork() {
  logger.debug("work started");
}
```

## Output Expectations

When reporting the result, include the files changed, the selected LoggerJS packages, the runtime assumptions, and the validation commands that passed or could not be run.
