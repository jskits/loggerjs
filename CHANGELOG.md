# Changelog

## 0.1.0 - Unreleased

### Added

- Core logger with level gating, lazy messages, typed events, ambient context, middleware compatibility, and console/memory/batch transports.
- Browser HTTP transport with batching, beacon pagehide delivery, offline replay hooks, and console/error/fetch/XHR/page lifecycle integrations.
- Node stdout/stderr/file/http/worker transports, AsyncLocalStorage context bridge, process integration, and diagnostics-channel integration.
- OTLP JSON mapping and transport, OpenTelemetry active span trace processor, and Sentry adapter transport.
- Public subpath exports, API reports, public type checks, package pack validation, size budgets, benchmarks, and release dry-run workflow.
- Node, browser, OTLP, and Sentry examples.

### Notes

- The package set is still pre-1.0. Public API reports are checked in to make intentional surface changes visible before the first release.
