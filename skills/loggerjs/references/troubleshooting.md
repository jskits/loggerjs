# Troubleshooting

## No Logs Appear

- Confirm the logger `level` allows the emitted level.
- Confirm at least one transport is configured.
- Confirm the app imports the configured local logger, not a fresh unconfigured logger.
- In libraries using `getLogger()`, confirm the host app configured the registry.
- Await `logger.flush()` in scripts, tests, and short-lived processes.

## Duplicate Logs

- Check whether both direct LoggerJS calls and console integration are capturing the same message.
- Ensure integration setup runs once per app lifecycle, not once per request or React render.
- In hot reload/dev servers, keep teardown logic or guard initialization with module-level state.

## Browser Delivery Fails

- Check network status, CORS, ingestion endpoint path, response status, and content type expectations.
- Do not send browser logs directly to private vendor APIs that require secret credentials.
- Enable page lifecycle flush for navigation/tab-close cases.
- Use an offline queue only after deciding quota and drop behavior.

## Process Exits Before Delivery

- Await `logger.flush()` before `process.exit()`.
- For CLIs, set `process.exitCode` and return instead of calling `process.exit()` immediately.
- Use stdout/file transports for crash-path reliability; remote network transports are best-effort during fatal shutdown.

## Encoding or Serialization Errors

- Do not call `JSON.stringify()` on log data before passing it to LoggerJS.
- Use built-in codecs or transport-owned codecs so Error, BigInt, circular values, and rich objects can be handled safely.
- Check LoggerJS meta counters when payloads are dropped, coerced, or encoded with fallback behavior.

## TypeScript Import Errors

- Use public package exports, not `dist` or source-internal paths.
- Re-run install after adding a LoggerJS package.
- For exact exports, check `https://jskits.github.io/loggerjs/reference/packages` and the package API report.
