import { setStateSharedAcrossCopies, sharedState, warnIfCoreCopiesUnshared } from "./host";
import { Logger } from "./logger";
import type { LoggerLevel } from "./levels";
import { normalizeCategory } from "./record";
import type {
  ChildLoggerOptions,
  EventDefinition,
  EventLogOptions,
  Integration,
  LogData,
  LoggerCategory,
  LoggerLike,
  LoggerOptions,
  Processor,
  Transport,
} from "./types";

export interface LoggerRoute {
  category: LoggerCategory;
  level?: LoggerLevel;
  transports?: string[];
  processors?: Processor[];
}

export interface ConfigureOptions {
  reset?: boolean;
  level?: LoggerLevel;
  processors?: Processor[];
  transports?: Record<string, Transport> | readonly Transport[];
  loggers?: LoggerRoute[];
  integrations?: Integration[];
  /**
   * Whether every copy of @loggerjs/core loaded into this process (for
   * example an ESM app and a CJS library, or two installed versions) shares
   * this registry, ambient context, and meta counters. `true` lets libraries
   * in other copies log through this configuration; `false` keeps copies
   * isolated, as independently bundled micro-frontends on one page need.
   * Left unset, copies stay isolated and configure() warns once when more
   * than one copy is loaded.
   */
  shareAcrossCopies?: boolean;
}

interface RuntimeRoute {
  category: readonly string[];
  level?: LoggerLevel;
  transports?: string[];
  processors: Processor[];
}

interface RuntimeSnapshot {
  level: LoggerLevel;
  processors: Processor[];
  transports: ReadonlyMap<string, Transport>;
  routes: RuntimeRoute[];
  integrations: Integration[];
  cache: Map<string, Logger>;
  integrationHost: Logger | null;
  // Builds the registry's loggers. With shareAcrossCopies, every copy of core
  // then creates them with the copy that called configure(), so a diagnostics
  // sink installed through that copy sees all of them. Snapshots from older
  // copies lack it, and the reading copy uses its own Logger instead.
  createLogger?: (options: LoggerOptions) => Logger;
}

const registry = /* @__PURE__ */ sharedState("registry", () => ({
  runtime: null as RuntimeSnapshot | null,
}));

function categoryKey(category: readonly string[]): string {
  return category.join(".");
}

function isPrefix(prefix: readonly string[], category: readonly string[]): boolean {
  if (prefix.length > category.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] !== category[index]) return false;
  }
  return true;
}

function routeSort(a: RuntimeRoute, b: RuntimeRoute): number {
  return b.category.length - a.category.length;
}

function sortRoutes(routes: RuntimeRoute[]): RuntimeRoute[] {
  const sorted: RuntimeRoute[] = [];
  for (const route of routes) {
    const index = sorted.findIndex((item) => routeSort(route, item) < 0);
    if (index === -1) sorted.push(route);
    else sorted.splice(index, 0, route);
  }
  return sorted;
}

function normalizeTransports(
  transports: Record<string, Transport> | readonly Transport[] | undefined,
): ReadonlyMap<string, Transport> {
  if (!transports) return new Map<string, Transport>();
  if (Array.isArray(transports)) {
    return new Map(
      transports.map((transport, index) => [transport.name ?? `transport-${index}`, transport]),
    );
  }
  return new Map(Object.entries(transports));
}

function allTransportNames(transports: ReadonlyMap<string, Transport>): string[] {
  return [...transports.keys()];
}

function selectRoute(
  snapshot: RuntimeSnapshot,
  category: readonly string[],
): RuntimeRoute | undefined {
  return snapshot.routes.find((route) => isPrefix(route.category, category));
}

function selectTransports(snapshot: RuntimeSnapshot, route: RuntimeRoute | undefined): Transport[] {
  const names = route?.transports ?? allTransportNames(snapshot.transports);
  return names.flatMap((name) => {
    const transport = snapshot.transports.get(name);
    return transport ? [transport] : [];
  });
}

function createRuntimeLogger(snapshot: RuntimeSnapshot, category: readonly string[]): Logger {
  const route = selectRoute(snapshot, category);
  const options: LoggerOptions = {
    category,
    level: route?.level ?? snapshot.level,
    processors: [...snapshot.processors, ...(route?.processors ?? [])],
    transports: selectTransports(snapshot, route),
  };
  return snapshot.createLogger ? snapshot.createLogger(options) : new Logger(options);
}

function getRuntimeLogger(category: readonly string[]): Logger | undefined {
  const runtime = registry().runtime;
  if (!runtime) return undefined;
  const key = categoryKey(category);
  const existing = runtime.cache.get(key);
  if (existing) return existing;
  const logger = createRuntimeLogger(runtime, category);
  runtime.cache.set(key, logger);
  return logger;
}

// The integration host only needs to deliver captures. Giving it forwarding
// transports without close() means closing the host tears down integrations
// and flushes, but never closes transports a later configuration still uses.
function hostTransport(transport: Transport): Transport {
  return {
    name: transport.name,
    minLevel: transport.minLevel,
    ready: transport.ready && (() => transport.ready?.()),
    write: transport.write && ((record, context) => transport.write?.(record, context)),
    writeBatch:
      transport.writeBatch && ((records, context) => transport.writeBatch?.(records, context)),
    log: transport.log && ((event, context) => transport.log?.(event, context)),
    logBatch: transport.logBatch && ((events, context) => transport.logBatch?.(events, context)),
    flush: transport.flush && (() => transport.flush?.()),
    flushSync: transport.flushSync && (() => transport.flushSync?.()),
  };
}

async function closeTransport(transport: Transport): Promise<void> {
  if (transport.close) await transport.close();
  else await transport.flush?.();
}

async function closeSnapshot(snapshot: RuntimeSnapshot | null): Promise<void> {
  if (!snapshot) return;
  await snapshot.integrationHost?.close();
  await Promise.all(
    [...snapshot.transports.values()].map((transport) => closeTransport(transport)),
  );
}

export async function resetLoggerRegistry(): Promise<void> {
  const previous = registry().runtime;
  registry().runtime = null;
  await closeSnapshot(previous);
}

export async function configure(options: ConfigureOptions = {}): Promise<void> {
  if (options.shareAcrossCopies === undefined) warnIfCoreCopiesUnshared();
  else setStateSharedAcrossCopies(options.shareAcrossCopies);
  const previous = options.reset ? null : registry().runtime;
  if (options.reset) await resetLoggerRegistry();
  // Reconfiguring replaces the previous snapshot: remove its integrations
  // before installing new ones so platform hooks are never patched twice.
  await previous?.integrationHost?.close();

  const transports = normalizeTransports(options.transports);
  const snapshot: RuntimeSnapshot = {
    level: options.level ?? "info",
    processors: [...(options.processors ?? [])],
    transports,
    routes: sortRoutes(
      (options.loggers ?? []).map((route) => ({
        category: normalizeCategory(route.category),
        level: route.level,
        transports: route.transports,
        processors: [...(route.processors ?? [])],
      })),
    ),
    integrations: [...(options.integrations ?? [])],
    cache: new Map(),
    integrationHost: null,
    createLogger: (loggerOptions) => new Logger(loggerOptions),
  };

  if (snapshot.integrations.length > 0) {
    snapshot.integrationHost = new Logger({
      category: ["loggerjs", "integration"],
      level: snapshot.level,
      processors: snapshot.processors,
      transports: [...snapshot.transports.values()].map(hostTransport),
      integrations: snapshot.integrations,
    });
  }

  registry().runtime = snapshot;

  if (previous) {
    // Close transports the new configuration no longer references; transports
    // passed again are kept open.
    const retained = new Set(snapshot.transports.values());
    await Promise.all(
      [...previous.transports.values()]
        .filter((transport) => !retained.has(transport))
        .map((transport) => closeTransport(transport)),
    );
  }
}

export class RegistryLogger implements LoggerLike {
  readonly category: readonly string[];

  constructor(category: LoggerCategory) {
    this.category = normalizeCategory(category);
  }

  child(options: ChildLoggerOptions = {}): RegistryLogger {
    if (options.category) return new RegistryLogger(options.category);
    return new RegistryLogger(this.category);
  }

  log(level: LoggerLevel, message: unknown, data?: LogData | string, props?: LogData): void {
    getRuntimeLogger(this.category)?.log(level, message, data, props);
  }

  trace(message: unknown, data?: LogData | string, props?: LogData): void {
    this.log("trace", message, data, props);
  }

  debug(message: unknown, data?: LogData | string, props?: LogData): void {
    this.log("debug", message, data, props);
  }

  info(message: unknown, data?: LogData | string, props?: LogData): void {
    this.log("info", message, data, props);
  }

  warn(message: unknown, data?: LogData | string, props?: LogData): void {
    this.log("warn", message, data, props);
  }

  error(message: unknown, data?: LogData | string, props?: LogData): void {
    this.log("error", message, data, props);
  }

  fatal(message: unknown, data?: LogData | string, props?: LogData): void {
    this.log("fatal", message, data, props);
  }

  captureException(error: unknown, data?: LogData): void {
    getRuntimeLogger(this.category)?.captureException(error, data);
  }

  event<TPayload extends Record<string, unknown>>(
    definition: EventDefinition<TPayload>,
    payload: TPayload,
    options?: EventLogOptions<TPayload>,
  ): void {
    getRuntimeLogger(this.category)?.event(definition, payload, options);
  }

  async ready(): Promise<void> {
    await getRuntimeLogger(this.category)?.ready();
  }

  async flush(): Promise<void> {
    await getRuntimeLogger(this.category)?.flush();
  }

  flushSync(): void {
    getRuntimeLogger(this.category)?.flushSync();
  }

  async close(): Promise<void> {
    await getRuntimeLogger(this.category)?.close();
  }
}

export function getLogger(category: LoggerCategory): RegistryLogger {
  return new RegistryLogger(category);
}
