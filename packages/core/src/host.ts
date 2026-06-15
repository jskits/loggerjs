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
