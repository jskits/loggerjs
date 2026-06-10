import type { BoundContext } from "./types";
import { createBoundContext } from "./record";

export type ContextProvider = () => Record<string, unknown> | undefined;

export interface ContextManager {
  get: () => BoundContext | undefined;
  with: <T>(context: Record<string, unknown>, fn: () => T) => T;
}

let provider: ContextProvider | undefined;

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
}

export function setContextManager(nextManager: ContextManager): void {
  manager = nextManager;
}

export function resetContextManager(): void {
  manager = createStackContextManager();
}

export function getContext(): BoundContext | undefined {
  return mergeContext(provider?.(), manager.get());
}

export function withContext<T>(context: Record<string, unknown>, fn: () => T): T {
  return manager.with(context, fn);
}
