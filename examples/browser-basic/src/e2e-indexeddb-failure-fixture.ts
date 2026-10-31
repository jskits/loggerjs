import {
  captureBrowserErrorsIntegration,
  createLogger,
  indexedDbTransport,
  recordToEvent,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/browser";

export type IndexedDbFailure = "write" | "count" | "sessions" | "request" | "transaction";

function event(id: string): LogEvent {
  return {
    id,
    time: Date.now(),
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "indexeddb-failure",
    message: id,
  };
}

async function runFailure(dbName: string, operation: IndexedDbFailure) {
  const unhandled: string[] = [];
  const onUnhandled = (rejection: PromiseRejectionEvent) => {
    unhandled.push(String(rejection.reason));
    rejection.preventDefault();
  };
  addEventListener("unhandledrejection", onUnhandled);
  const dropped: Array<[string, string]> = [];
  const transport = indexedDbTransport({
    dbName,
    flushIntervalMs: 10_000,
    onDrop: (entry, reason) => dropped.push([entry.id, reason]),
  });
  const context: TransportContext = {
    loggerName: "indexeddb-failure",
    now: Date.now,
    toEvent: recordToEvent,
    reportInternalError: () => {},
  };
  const injected = new DOMException("injected storage failure", "QuotaExceededError");
  const originalPut = IDBObjectStore.prototype.put;
  const originalCount = IDBObjectStore.prototype.count;
  const originalOpenCursor = IDBIndex.prototype.openCursor;
  const fail = () => {
    throw injected;
  };
  let errorName: string | undefined;
  let errorMessage: string | undefined;
  let sameError = false;
  try {
    if (operation === "write") IDBObjectStore.prototype.put = fail;
    if (operation === "sessions") IDBIndex.prototype.openCursor = fail;
    if (operation === "count") IDBObjectStore.prototype.count = fail;
    if (operation === "request") {
      // Use a real asynchronous ConstraintError, without depending on quota or
      // on the transport's schema version: the second add repeats the first key.
      IDBObjectStore.prototype.put = function (value) {
        return this.add({ ...value, id: "duplicate" });
      };
    }
    if (operation === "transaction") {
      IDBObjectStore.prototype.count = function (...args) {
        const request = originalCount.apply(this, args);
        request.addEventListener("success", () => queueMicrotask(() => this.transaction.abort()), {
          once: true,
        });
        return request;
      };
    }
    try {
      if (operation === "count" || operation === "transaction") await transport.count();
      else if (operation === "sessions") await transport.sessions();
      else {
        transport.log?.(event("first"), context);
        transport.log?.(event("second"), context);
        await transport.flush?.();
      }
    } catch (error) {
      if (error instanceof Error || error instanceof DOMException) {
        errorName = error.name;
        errorMessage = error.message;
      }
      sameError = error === injected;
    } finally {
      IDBObjectStore.prototype.put = originalPut;
      IDBObjectStore.prototype.count = originalCount;
      IDBIndex.prototype.openCursor = originalOpenCursor;
    }
    // Abort and unhandledrejection notifications occur after the request error.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const countAfterFailure = await transport.count();
    const sessionsAfterFailure = await transport.sessions();
    const stats = transport.stats();
    transport.log?.(event("recovered"), context);
    await transport.flush?.();
    const recoveredCount = await transport.count();
    return {
      errorName,
      errorMessage,
      sameError,
      unhandled,
      dropped,
      countAfterFailure,
      sessionsAfterFailure,
      recoveredCount,
      stats,
    };
  } finally {
    await transport.close?.();
    removeEventListener("unhandledrejection", onUnhandled);
  }
}

async function runErrorCapture(dbName: string) {
  let unhandled = 0;
  const onUnhandled = (rejection: PromiseRejectionEvent) => {
    unhandled += 1;
    rejection.preventDefault();
    // Bound a regression before the integration captures another rejected write.
    if (unhandled >= 8) rejection.stopImmediatePropagation();
  };
  addEventListener("unhandledrejection", onUnhandled);
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = () => {
    throw new DOMException("injected storage failure", "QuotaExceededError");
  };
  const captured: string[] = [];
  let internalErrors = 0;
  const transport = indexedDbTransport({ dbName, flushIntervalMs: 0 });
  const logger = createLogger({
    transports: [
      transport,
      {
        name: "observe",
        log: (entry) => {
          captured.push(entry.message);
        },
      },
    ],
    integrations: [captureBrowserErrorsIntegration()],
    onInternalError: () => {
      internalErrors += 1;
    },
  });
  try {
    logger.info("one application log");
    await logger.flush().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { unhandled, captured, internalErrors };
  } finally {
    IDBObjectStore.prototype.put = originalPut;
    await logger.close();
    removeEventListener("unhandledrejection", onUnhandled);
  }
}

declare global {
  interface Window {
    loggerjsIndexedDbFailureE2e: {
      runFailure: typeof runFailure;
      runErrorCapture: typeof runErrorCapture;
    };
  }
}

window.loggerjsIndexedDbFailureE2e = { runFailure, runErrorCapture };
