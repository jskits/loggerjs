# Production Checklist

Apply this before broad rollout or before adding automatic capture.

## Privacy

- Add `redactProcessor()` or a stricter privacy processor before any remote transport.
- Redact tokens, cookies, authorization headers, passwords, secrets, session IDs, and user-provided free-form fields.
- Keep raw request/response bodies out of default logs unless the app has a clear data classification rule.
- In browser code, assume all bundled environment variables and network payloads are inspectable by users.

## Reliability

- Use bounded queues. Choose an explicit drop policy instead of allowing unbounded memory growth.
- Pair network transports with batch size, flush interval, retry/backoff, and circuit-breaker settings appropriate to the destination.
- Call `flush()` on controlled shutdown, CLI exit, worker teardown, and tests that assert delivery.
- Use crash-path synchronous flush only for local process-safe transports; remote network delivery is best-effort during crashes.
- Track LoggerJS self-metrics, drop counters, and transport errors in the app's existing observability path.

## Browser Lifecycle

- Enable page lifecycle integration when logs matter during tab close or navigation.
- Treat `sendBeacon` as a last-chance attempt, not a delivery guarantee.
- Use IndexedDB/offline queues when reload survival matters, but handle quota, private browsing, eviction, and blocked upgrades.
- Prefer sampling or rate limits for high-volume browser debug/info events.

## Performance

- Keep expensive message construction behind the logger level gate.
- Prefer structured data over preformatted strings when fields are later redacted, routed, or indexed.
- Use processors only when event-level behavior is required; processor use disables the pure record fast path.
- Keep hot-path browser integrations scoped to needed signals.
- Benchmark if changing codec, batching, sampling, or high-volume call sites.

## Vendor Delivery

- Server-side vendor packages may use private credentials from environment variables.
- Browser logs should flow through an application-owned ingestion endpoint or a public-safe token model.
- Name the target service and region/site explicitly for Datadog, CloudWatch, Loki, Elasticsearch, Sentry, or OTLP.
- Add a fallback or secondary transport when delivery is operationally critical.
