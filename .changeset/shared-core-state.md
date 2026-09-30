---
"@loggerjs/core": minor
---

Add `configure({ shareAcrossCopies })` for processes that load more than one copy of `@loggerjs/core`, such as an ESM application with a CJS library, or two installed versions. Each copy keeps its own registry, ambient context, and meta counters, so a library's `getLogger()` in another copy ignored the application's `configure()` and its logs were silently dropped.

- `shareAcrossCopies: true` moves that state into one process-wide store that every copy uses, so libraries in other copies log through the application's configuration.
- `shareAcrossCopies: false` keeps copies isolated, which is what independently bundled micro-frontends on one page want.
- Left unset, behavior is unchanged, and `configure()` warns once when it sees more than one copy loaded.
