import { AsyncLocalStorage } from "node:async_hooks";
import {
  createBoundContext,
  resetContextManager,
  setContextManager,
  type BoundContext,
  type ContextManager,
} from "@loggerjs/core";

function mergeContext(
  ...items: Array<Record<string, unknown> | undefined | null>
): BoundContext | undefined {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (!item) continue;
    Object.assign(out, item);
  }
  return createBoundContext(out) ?? undefined;
}

export function createAsyncLocalStorageContextManager(
  storage = new AsyncLocalStorage<BoundContext>(),
): ContextManager & { disable: () => void } {
  return {
    get() {
      return storage.getStore();
    },
    with(context, fn) {
      return storage.run(mergeContext(storage.getStore(), context) ?? Object.freeze({}), fn);
    },
    disable() {
      storage.disable();
    },
  };
}

export function installAsyncLocalStorageContext(
  manager = createAsyncLocalStorageContextManager(),
): () => void {
  setContextManager(manager);
  return () => {
    resetContextManager();
    manager.disable();
  };
}
