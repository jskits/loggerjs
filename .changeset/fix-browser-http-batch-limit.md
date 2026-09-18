---
"@loggerjs/browser": patch
---

Make `browserHttpTransport` enforce `maxBatchSize` on new Fetch and Beacon batches and drain queued batches serially, including partial tails with timers disabled. Concurrent flush/close calls wait for active delivery; failed batches retain their order without replaying earlier successful batches. Lifecycle Beacon submission can drain queued events while Fetch is pending, and partial Beacon failures retain only unsent events.

`maxBatchSize` must now be a positive safe integer. Smaller batches can increase request and codec/transform counts; offline entry limits count requests. Existing offline payloads replay unchanged. The event limit does not impose a Fetch byte budget or global ordering across offline replay, live delivery, and Beacon.
