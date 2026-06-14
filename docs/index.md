---
layout: home

hero:
  name: LoggerJS
  text: Isomorphic structured logging for JavaScript
  tagline: One pipeline from browser collection to server delivery, with composable processing and measured performance.
  image:
    src: /logo.svg
    alt: LoggerJS logo
  actions:
    - theme: brand
      text: Get Started
      link: /GETTING-STARTED
    - theme: alt
      text: View Packages
      link: /reference/packages
    - theme: alt
      text: API Reference
      link: /reference/api/

features:
  - title: Browser and server
    details: The same logger model runs in browsers, Node.js, workers, and edge runtimes.
  - title: Automatic collection
    details: Opt-in integrations capture console calls, errors, network failures, routes, process events, HTTP frameworks, queues, and databases.
  - title: Reliable delivery
    details: Transports own codecs and can use batching, retry, backoff, offline replay, crash-path flushing, and beacon delivery.
  - title: Composable processing
    details: Middleware and processors enrich, redact, sample, dedupe, fingerprint, route, and buffer logs before delivery.
  - title: Measured hot path
    details: Benchmarks and CI gates cover disabled levels, lean NDJSON, prepared encoders, batching, browser delivery, and size budgets.
  - title: Library-safe defaults
    details: Library loggers stay silent until the host app configures LoggerJS, so dependencies can log without forcing output.
---

## The LoggerJS Pipeline

<div class="loggerjs-pipeline">
  <span><strong>Collect</strong>Manual logs plus browser and Node integrations.</span>
  <span><strong>Shape</strong>Middleware keeps raw records cheap and composable.</span>
  <span><strong>Process</strong>Processors project events only when richer behavior is needed.</span>
  <span><strong>Deliver</strong>Transports choose codecs, batching, retries, and destinations.</span>
</div>

```ts
import { createLogger, stdoutTransport } from "@loggerjs/node";
import { redactProcessor } from "@loggerjs/processors";

const logger = createLogger({
  category: ["api"],
  level: "info",
  processors: [redactProcessor({ keys: ["password", /token/i] })],
  transports: [stdoutTransport()],
});

logger.info("order created", { orderId: "ord_123" });
await logger.flush();
```

## Where To Start

<div class="loggerjs-home-grid">
  <div class="loggerjs-home-panel">
    <h2>New project</h2>
    <p>Start with the Node or browser quick start, then add processors and transports for your runtime.</p>
  </div>
  <div class="loggerjs-home-panel">
    <h2>Production rollout</h2>
    <p>Use the production recipes and operations guide for privacy, offline queues, crash paths, and vendor delivery.</p>
  </div>
  <div class="loggerjs-home-panel">
    <h2>API lookup</h2>
    <p>Use the generated package and API reference pages for exports, subpaths, and public declaration reports.</p>
  </div>
</div>

## Documentation Map

- [Getting Started](/GETTING-STARTED) covers installation, first loggers, levels, lazy messages, context, and typed events.
- [Concepts](/CONCEPTS) explains records, events, middleware, processors, transports, codecs, integrations, and routing.
- [Transports](/TRANSPORTS), [Integrations](/INTEGRATIONS), [Processors](/PROCESSORS), and [Codecs](/CODECS) are the main implementation references.
- [Production Recipes](/PRODUCTION-RECIPES), [Operations](/OPERATIONS), and [Performance](/PERFORMANCE) cover rollout choices.
- [Benchmarks](/BENCHMARKS), [Benchmark Matrix](/BENCHMARK-MATRIX), and [Comparison](/COMPARISON) keep performance and positioning grounded in checked-in evidence.
- [Packages](/reference/packages), [API Reports](/reference/api/), and [Examples](/examples) are generated from the current repository.
