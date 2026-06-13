import { incrementLoggerMetaCounter } from "./meta";
import type {
  CaptureInput,
  ConsoleMethod,
  IntegrationSetupContext,
  LoggerCategory,
  LoggerLike,
  Teardown,
  UnpatchedRegistry,
} from "./types";

const UNPATCHED_REGISTRY_KEY = "__LOGGERJS_UNPATCHED_REGISTRY__";
const consoleMethods: ConsoleMethod[] = ["debug", "error", "info", "log", "trace", "warn"];

interface UnpatchedStore {
  console: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>>;
  fetch?: UnpatchedRegistry["fetch"];
  XMLHttpRequest?: UnpatchedRegistry["XMLHttpRequest"];
  values: Map<string, unknown>;
}

export interface CreateIntegrationSetupContextOptions {
  name: string;
  logger: LoggerLike;
  capture: (input: CaptureInput) => void;
  getLogger: (category: LoggerCategory) => LoggerLike;
}

function globalStore(): UnpatchedStore {
  const global = globalThis as unknown as Record<string, unknown>;
  const existing = global[UNPATCHED_REGISTRY_KEY] as UnpatchedStore | undefined;
  if (existing) return existing;

  const store: UnpatchedStore = {
    console: {},
    values: new Map<string, unknown>(),
  };
  global[UNPATCHED_REGISTRY_KEY] = store;
  return store;
}

export function getUnpatchedRegistry(): UnpatchedRegistry {
  const store = globalStore();
  return {
    console: store.console,
    get fetch() {
      return store.fetch;
    },
    set fetch(value) {
      store.fetch = value;
    },
    get XMLHttpRequest() {
      return store.XMLHttpRequest;
    },
    set XMLHttpRequest(value) {
      store.XMLHttpRequest = value;
    },
    get<T = unknown>(key: string): T | undefined {
      return store.values.get(key) as T | undefined;
    },
    set<T = unknown>(key: string, value: T): T {
      store.values.set(key, value);
      return value;
    },
  };
}

export function registerUnpatchedDefaults(registry = getUnpatchedRegistry()): UnpatchedRegistry {
  if (typeof console !== "undefined") {
    const source = console as unknown as Partial<
      Record<ConsoleMethod, (...args: unknown[]) => void>
    >;
    for (const method of consoleMethods) {
      registry.console[method] ??= source[method];
    }
  }

  return registry;
}

export function onceTeardown(teardown: Teardown): Teardown {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    teardown();
  };
}

export function createIntegrationSetupContext(
  options: CreateIntegrationSetupContextOptions,
): IntegrationSetupContext {
  const unpatched = registerUnpatchedDefaults();
  const source = `integration:${options.name}`;
  let guardDepth = 0;

  return {
    log: (...args) => options.logger.log(...args),
    trace: (...args) => options.logger.trace(...args),
    debug: (...args) => options.logger.debug(...args),
    info: (...args) => options.logger.info(...args),
    warn: (...args) => options.logger.warn(...args),
    error: (...args) => options.logger.error(...args),
    fatal: (...args) => options.logger.fatal(...args),
    captureException: (...args) => options.logger.captureException(...args),
    event: (...args) => options.logger.event(...args),
    ready: () => options.logger.ready(),
    flush: () => options.logger.flush(),
    flushSync: () => options.logger.flushSync?.(),
    close: () => options.logger.close(),
    capture(input) {
      options.capture({ ...input, source });
    },
    getLogger: options.getLogger,
    unpatched,
    guard<T extends (...args: never[]) => unknown>(fn: T): T {
      const guarded = function guarded(this: unknown, ...args: unknown[]) {
        if (guardDepth > 0) {
          incrementLoggerMetaCounter("integration.dropped");
          incrementLoggerMetaCounter("integration.dropped.reentrant");
          return undefined;
        }

        guardDepth += 1;
        try {
          return fn.apply(this, args as never[]);
        } finally {
          guardDepth -= 1;
        }
      };
      return guarded as unknown as T;
    },
  };
}
