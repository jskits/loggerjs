import type { BoundContext } from "./types";
import { createBoundContext } from "./record";

export type ContextProvider = () => Record<string, unknown> | undefined;

export interface ContextManager {
  get: () => BoundContext | undefined;
  with: <T>(context: Record<string, unknown>, fn: () => T) => T;
}

let provider: ContextProvider | undefined;
const addedProviders: Array<{ provider: ContextProvider }> = [];

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

function createStackContextManager(): ContextManager {
  const stack: BoundContext[] = [];
  return {
    get() {
      return stack[stack.length - 1];
    },
    with(context, fn) {
      stack.push(mergeContext(stack[stack.length - 1], context) ?? Object.freeze({}));
      try {
        return fn();
      } finally {
        stack.pop();
      }
    },
  };
}

let manager = createStackContextManager();

export function setContextProvider(nextProvider: ContextProvider | undefined): void {
  provider = nextProvider;
  addedProviders.length = 0;
}

export function addContextProvider(nextProvider: ContextProvider): () => void {
  const entry = { provider: nextProvider };
  addedProviders.push(entry);
  return () => {
    const index = addedProviders.indexOf(entry);
    if (index >= 0) addedProviders.splice(index, 1);
  };
}

export function setContextManager(nextManager: ContextManager): void {
  manager = nextManager;
}

export function resetContextManager(): void {
  manager = createStackContextManager();
}

export function getContext(): BoundContext | undefined {
  const provided = mergeContext(provider?.(), ...addedProviders.map((entry) => entry.provider()));
  const managed = manager.get();
  // Fast paths: most log calls have no ambient context at all, and merging
  // allocates twice. Managed contexts are already frozen BoundContexts and
  // can be returned as-is.
  if (provided === undefined || provided === null) return managed;
  if (managed === undefined) return createBoundContext(provided) ?? undefined;
  return mergeContext(provided, managed);
}

export function withContext<T>(context: Record<string, unknown>, fn: () => T): T {
  return manager.with(context, fn);
}
