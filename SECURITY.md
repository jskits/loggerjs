# Security Policy

LoggerJS handles application logs, error payloads, redaction, and offline
delivery. Please report security issues privately before publishing details.

## Supported Versions

LoggerJS is pre-1.0. Security fixes target the latest released minor line only.
Older 0.x releases may receive fixes when the patch is low-risk, but users
should expect to upgrade to the newest 0.x release for security updates.

## Reporting a Vulnerability

Use GitHub private vulnerability reporting for
`github.com/jskits/loggerjs` when available. Include:

- affected package and version,
- a minimal reproduction or attack string,
- expected impact,
- whether the issue is already public.

If private reporting is unavailable, open a public issue that asks for a secure
contact path without including exploit details.

## Response Targets

- Initial acknowledgement: within 7 days.
- Triage decision: within 14 days when a reproduction is provided.
- Fix and advisory timing: coordinated with the reporter based on severity and
  release risk.

## Scope

Security-sensitive areas include:

- privacy/redaction processors,
- codecs and serialization fallbacks,
- browser persistence and offline replay,
- transport retry, batching, and queue behavior,
- vendor signing or authentication helpers,
- prototype pollution, ReDoS, and denial-of-service inputs.

## Redaction Model and Limits

The two redaction processors cover different threats, and most apps want both:

- `redactProcessor` is **key-based**: it masks values whose key or path matches
  your `keys`/`paths` — including keys carried on `Error` own properties and
  inside `Map`/`Set`. It does not inspect free-text values.
- `privacyGuardProcessor` is **value-based**: it scans string *content* for
  patterns (emails, tokens, card numbers, custom regexes) regardless of key.

By design, `redactProcessor` preserves `Error` `message`/`stack` strings verbatim
(they are not keys). If those may contain secrets or PII — e.g. an error message
that embeds a token, or a stack with a query string — pair it with
`privacyGuardProcessor`. Neither processor scans values inside opaque/binary
payloads or already-stringified blobs; redact before serialization, not after.
