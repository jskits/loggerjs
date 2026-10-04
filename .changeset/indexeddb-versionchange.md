---
"@loggerjs/browser": patch
---

`indexedDbTransport()` and `indexedDbBrowserHttpOfflineQueue()` close their connection when another tab needs to upgrade or delete the database, and reopen it on next use. Previously an open tab blocked a newer app version in another tab from upgrading the database.
