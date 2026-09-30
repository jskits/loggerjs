import type { BoundContext } from "./types";
import { sharedState } from "./host";
import { createBoundContext } from "./record";

export type ContextProvider = () => Record<string, unknown> | undefined;

export interface ContextManager {
  get: () => BoundContext | undefined;
  with: <T>(context: Record<string, unknown>, fn: () => T) => T;
}

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

const state = /* @__PURE__ */ sharedState("context", () => ({
  provider: undefined as ContextProvider | undefined,
  addedProviders: [] as Array<{ provider: ContextProvider }>,
  manager: createStackContextManager(),
}));

export function setContextProvider(nextProvider: ContextProvider | undefined): void {
  const current = state();
  current.provider = nextProvider;
  current.addedProviders.length = 0;
}

export function addContextProvider(nextProvider: ContextProvider): () => void {
  const entry = { provider: nextProvider };
  const { addedProviders } = state();
  addedProviders.push(entry);
  return () => {
    const index = addedProviders.indexOf(entry);
    if (index >= 0) addedProviders.splice(index, 1);
  };
}

export function setContextManager(nextManager: ContextManager): void {
  state().manager = nextManager;
}

export function resetContextManager(): void {
  state().manager = createStackContextManager();
}

export function getContext(): BoundContext | undefined {
  const { provider, addedProviders, manager } = state();
  const managed = manager.get();
  // True fast path: with no global provider and no added providers (the common
  // case) there is nothing to merge, so skip the .map() array allocation, the
  // spread, and the mergeContext({}) object/Object.keys allocations entirely.
  if (provider === undefined && addedProviders.length === 0) return managed;
  const provided = mergeContext(provider?.(), ...addedProviders.map((entry) => entry.provider()));
  // Fast paths: most log calls have no ambient context at all, and merging
  // allocates twice. Managed contexts are already frozen BoundContexts and
  // can be returned as-is.
  if (provided === undefined || provided === null) return managed;
  if (managed === undefined) return createBoundContext(provided) ?? undefined;
  return mergeContext(provided, managed);
}

export function withContext<T>(context: Record<string, unknown>, fn: () => T): T {
  return state().manager.with(context, fn);
}
