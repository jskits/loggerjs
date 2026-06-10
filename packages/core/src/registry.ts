import { Logger } from "./logger";
import type { LoggerLevel } from "./levels";
import { normalizeCategory } from "./record";
import type {
  ChildLoggerOptions,
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
}

let runtime: RuntimeSnapshot | null = null;

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
  return new Logger(options);
}

function getRuntimeLogger(category: readonly string[]): Logger | undefined {
  if (!runtime) return undefined;
  const key = categoryKey(category);
  const existing = runtime.cache.get(key);
  if (existing) return existing;
  const logger = createRuntimeLogger(runtime, category);
  runtime.cache.set(key, logger);
  return logger;
}

async function closeSnapshot(snapshot: RuntimeSnapshot | null): Promise<void> {
  if (!snapshot) return;
  await snapshot.integrationHost?.close();
  await Promise.all([...snapshot.transports.values()].map((transport) => transport.close?.()));
}

export async function resetLoggerRegistry(): Promise<void> {
  const previous = runtime;
  runtime = null;
  await closeSnapshot(previous);
}

export async function configure(options: ConfigureOptions = {}): Promise<void> {
  if (options.reset) await resetLoggerRegistry();

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
  };

  if (snapshot.integrations.length > 0) {
    snapshot.integrationHost = new Logger({
      category: ["loggerjs", "integration"],
      level: snapshot.level,
      processors: snapshot.processors,
      transports: [...snapshot.transports.values()],
      integrations: snapshot.integrations,
    });
  }

  runtime = snapshot;
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

  async flush(): Promise<void> {
    await getRuntimeLogger(this.category)?.flush();
  }

  async close(): Promise<void> {
    await getRuntimeLogger(this.category)?.close();
  }
}

export function getLogger(category: LoggerCategory): RegistryLogger {
  return new RegistryLogger(category);
}
