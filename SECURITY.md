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
