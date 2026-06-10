import { enabledLevelNames, levelValues, toLevelName, toLevelValue, type EnabledLogLevelName, type LoggerLevel } from "./levels";
import { normalizeError, valueToMessage } from "./utils/error";
import type {
  ChildLoggerOptions,
  Integration,
  LogData,
  LogEvent,
  LoggerLike,
  LoggerOptions,
  Processor,
  ProcessorContext,
  Tags,
  Transport,
  TransportContext
} from "./types";

let globalSeq = 0;

function defaultClock() {
  return Date.now();
}

function defaultIdFactory(event: Pick<LogEvent, "time" | "seq" | "levelName" | "logger">): string {
  return `${event.time.toString(36)}-${event.seq.toString(36)}-${event.levelName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Error);
}

function mergeTags(...items: Array<Tags | undefined>): Tags | undefined {
  const out: Tags = {};
  for (const item of items) {
    if (!item) continue;
    for (const [key, value] of Object.entries(item)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mergeRecords(...items: Array<Record<string, unknown> | undefined>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (!item) continue;
    Object.assign(out, item);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeData(data: LogData | undefined): { data?: unknown; error?: LogEvent["error"] } {
  if (data instanceof Error) return { error: normalizeError(data) };
  if (isRecord(data) && data.error instanceof Error) {
    const { error, ...rest } = data;
    return { data: rest, error: normalizeError(error) };
  }
  return data === undefined ? {} : { data };
}

export class Logger implements LoggerLike {
  readonly name: string;
  private minimumLevel: LoggerLevel;
  private type?: string;
  private tags?: Tags;
  private bindings?: Record<string, unknown>;
  private processors: Processor[];
  private transports: Transport[];
  private integrations: Integration[];
  private disposers: Array<() => void> = [];
  private contextProvider?: () => Record<string, unknown> | undefined;
  private clock: () => number;
  private idFactory: (event: Pick<LogEvent, "time" | "seq" | "levelName" | "logger">) => string;
  private onInternalError?: (error: unknown, detail?: Record<string, unknown>) => void;
  private closed = false;

  constructor(options: LoggerOptions = {}) {
    this.name = options.name ?? "app";
    this.minimumLevel = options.level ?? "info";
    this.type = options.type;
    this.tags = mergeTags(options.tags);
    this.bindings = mergeRecords(options.bindings);
    this.processors = [...(options.processors ?? [])];
    this.transports = [...(options.transports ?? [])];
    this.integrations = [...(options.integrations ?? [])];
    this.contextProvider = options.contextProvider;
    this.clock = options.clock ?? defaultClock;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.onInternalError = options.onInternalError;
    this.installIntegrations();
  }

  setLevel(level: LoggerLevel) {
    this.minimumLevel = level;
  }

  getLevel(): LoggerLevel {
    return this.minimumLevel;
  }

  isEnabled(level: LoggerLevel): boolean {
    return toLevelValue(level) >= toLevelValue(this.minimumLevel);
  }

  child(options: ChildLoggerOptions = {}): Logger {
    return new Logger({
      name: options.name ?? this.name,
      level: options.level ?? this.minimumLevel,
      type: options.type ?? this.type,
      tags: mergeTags(this.tags, options.tags),
      bindings: mergeRecords(this.bindings, options.bindings),
      processors: [...this.processors, ...(options.processors ?? [])],
      transports: [...this.transports, ...(options.transports ?? [])],
      integrations: options.integrations ?? [],
      contextProvider: this.contextProvider,
      clock: this.clock,
      idFactory: this.idFactory,
      onInternalError: this.onInternalError
    });
  }

  withTags(tags: Tags): Logger {
    return this.child({ tags });
  }

  withType(type: string): Logger {
    return this.child({ type });
  }

  addProcessor(processor: Processor) {
    this.processors.push(processor);
  }

  addTransport(transport: Transport) {
    this.transports.push(transport);
  }

  addIntegration(integration: Integration) {
    this.integrations.push(integration);
    const dispose = integration.setup(this);
    if (typeof dispose === "function") this.disposers.push(dispose);
  }

  log(level: LoggerLevel, message: unknown, data?: LogData) {
    if (this.closed) return;
    const levelValue = toLevelValue(level);
    if (levelValue < toLevelValue(this.minimumLevel)) return;
    const levelName = typeof level === "string" && enabledLevelNames.includes(level as EnabledLogLevelName)
      ? (level as EnabledLogLevelName)
      : toLevelName(levelValue);
    const time = this.clock();
    const seq = globalSeq++;
    const normalized = normalizeData(data);
    const context = mergeRecords(this.bindings, this.contextProvider?.());

    let event: LogEvent = {
      id: "",
      time,
      seq,
      level: levelValue,
      levelName,
      logger: this.name,
      message: valueToMessage(message),
      type: this.type,
      tags: this.tags,
      context,
      ...normalized
    };
    event.id = this.idFactory(event);

    if (message instanceof Error && !event.error) {
      event.error = normalizeError(message);
      if (data === undefined) event.data = undefined;
    }

    const processed = this.applyProcessors(event);
    if (!processed) return;
    this.dispatch(processed);
  }

  trace(message: unknown, data?: LogData) {
    this.log("trace", message, data);
  }

  debug(message: unknown, data?: LogData) {
    this.log("debug", message, data);
  }

  info(message: unknown, data?: LogData) {
    this.log("info", message, data);
  }

  warn(message: unknown, data?: LogData) {
    this.log("warn", message, data);
  }

  error(message: unknown, data?: LogData) {
    this.log("error", message, data);
  }

  fatal(message: unknown, data?: LogData) {
    this.log("fatal", message, data);
  }

  captureException(error: unknown, data?: LogData) {
    const payload = isRecord(data) ? { ...data, error } : { value: data, error };
    this.log("error", error instanceof Error ? error.message : "Captured exception", payload);
  }

  async flush() {
    await Promise.all(this.transports.map((transport) => transport.flush?.()));
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        this.reportInternalError(error, { phase: "dispose" });
      }
    }
    await Promise.all(this.transports.map((transport) => transport.close?.() ?? transport.flush?.()));
  }

  private installIntegrations() {
    for (const integration of this.integrations) {
      try {
        const dispose = integration.setup(this);
        if (typeof dispose === "function") this.disposers.push(dispose);
      } catch (error) {
        this.reportInternalError(error, { phase: "integration-setup", integration: integration.name });
      }
    }
  }

  private applyProcessors(event: LogEvent): LogEvent | undefined {
    let current = event;
    const context: ProcessorContext = {
      loggerName: this.name,
      now: this.clock,
      reportInternalError: (error, detail) => this.reportInternalError(error, detail)
    };

    for (const processor of this.processors) {
      try {
        const result = processor(current, context);
        if (result === false) return undefined;
        if (result) current = result;
      } catch (error) {
        this.reportInternalError(error, { phase: "processor" });
      }
    }
    return current;
  }

  private dispatch(event: LogEvent) {
    const context: TransportContext = {
      loggerName: this.name,
      now: this.clock,
      reportInternalError: (error, detail) => this.reportInternalError(error, detail)
    };

    for (const transport of this.transports) {
      if (transport.minLevel !== undefined && event.level < toLevelValue(transport.minLevel)) continue;
      try {
        if (transport.log) {
          void Promise.resolve(transport.log(event, context)).catch((error) => {
            this.reportInternalError(error, { phase: "transport", transport: transport.name });
          });
        } else if (transport.logBatch) {
          void Promise.resolve(transport.logBatch([event], context)).catch((error) => {
            this.reportInternalError(error, { phase: "transport", transport: transport.name });
          });
        }
      } catch (error) {
        this.reportInternalError(error, { phase: "transport", transport: transport.name });
      }
    }
  }

  private reportInternalError(error: unknown, detail?: Record<string, unknown>) {
    if (this.onInternalError) {
      try {
        this.onInternalError(error, detail);
        return;
      } catch {
        // fall through to console
      }
    }
    try {
      console.error("[loggerjs internal error]", error, detail ?? {});
    } catch {
      // no-op
    }
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}

export { levelValues };
