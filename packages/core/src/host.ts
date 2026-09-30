import type { ConsoleMethod } from "./types";

export type RuntimeTimerHandle = unknown;

interface RuntimeTextEncoder {
  encode(input?: string): Uint8Array;
}

interface RuntimeGlobal {
  console?: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>>;
  performance?: {
    now?: () => number;
  };
  setTimeout?: (callback: () => void, delayMs?: number) => RuntimeTimerHandle;
  clearTimeout?: (handle: RuntimeTimerHandle) => void;
  TextEncoder?: new () => RuntimeTextEncoder;
}

export const runtimeHost = globalThis as unknown as RuntimeGlobal;

// Each loaded copy of @loggerjs/core (an ESM and a CJS build, or two installed
// versions) keeps its own registry, ambient context, and meta counters until
// the application calls configure({ shareAcrossCopies: true }). The switch and
// the shared slots live on globalThis so that every copy sees them. Bump the
// protocol suffix only when the shape of a slot changes incompatibly.
interface CoreCopies {
  loaded: number;
  shared: boolean;
  warned: boolean;
  slots: Record<string, object>;
}

const CORE_COPIES_KEY = Symbol.for("@loggerjs/core/shared-state/v1");

function coreCopiesState(): CoreCopies {
  const global = globalThis as unknown as Record<symbol, CoreCopies | undefined>;
  let state = global[CORE_COPIES_KEY];
  if (!state) {
    state = { loaded: 0, shared: false, warned: false, slots: Object.create(null) };
    Object.defineProperty(globalThis, CORE_COPIES_KEY, { value: state });
  }
  return state;
}

const coreCopies = coreCopiesState();
coreCopies.loaded += 1;
const localSlots: Record<string, object> = Object.create(null);

// Returns an accessor rather than the slot itself, because the slot moves to
// the process-wide store when sharing is switched on.
export function sharedState<T extends object>(name: string, init: () => T): () => T {
  return () => ((coreCopies.shared ? coreCopies.slots : localSlots)[name] ??= init()) as T;
}

export function setStateSharedAcrossCopies(shared: boolean): void {
  if (shared && !coreCopies.shared) {
    // Carry this copy's state over so switching does not lose a configured
    // registry or an installed context manager.
    for (const [name, slot] of Object.entries(localSlots)) coreCopies.slots[name] ??= slot;
  }
  coreCopies.shared = shared;
  coreCopies.warned = true;
}

export function warnIfCoreCopiesUnshared(): void {
  if (coreCopies.shared || coreCopies.warned || coreCopies.loaded < 2) return;
  coreCopies.warned = true;
  runtimeHost.console?.warn?.(
    `[loggerjs] ${coreCopies.loaded} copies of @loggerjs/core are loaded, and loggers from the other copies (for example a CJS library in an ESM app) do not see this configuration. Pass configure({ shareAcrossCopies: true }) to share it, or shareAcrossCopies: false to keep the copies isolated and silence this warning.`,
  );
}

let cachedTextEncoder: RuntimeTextEncoder | undefined;

function encodeUtf8Fallback(input: string): Uint8Array {
  const bytes = unescape(
    encodeURIComponent(
      input.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (match) =>
        match.length === 2 ? match : "\uFFFD",
      ),
    ),
  );
  return Uint8Array.from(bytes, (byte) => byte.charCodeAt(0));
}

export function encodeUtf8(input: string): Uint8Array {
  const TextEncoderCtor = runtimeHost.TextEncoder;
  cachedTextEncoder ??= typeof TextEncoderCtor === "function" ? new TextEncoderCtor() : undefined;
  return cachedTextEncoder?.encode(input) ?? encodeUtf8Fallback(input);
}

export function runtimeNow(): number {
  return runtimeHost.performance?.now?.() ?? Date.now();
}

export function setRuntimeTimeout(
  callback: () => void,
  delayMs: number,
): RuntimeTimerHandle | undefined {
  return runtimeHost.setTimeout?.(callback, delayMs);
}

export function clearRuntimeTimeout(handle: RuntimeTimerHandle | undefined): void {
  if (handle !== undefined) runtimeHost.clearTimeout?.(handle);
}

export function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const handle = setRuntimeTimeout(resolve, delayMs);
    if (handle === undefined) resolve();
  });
}
