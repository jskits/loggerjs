import {
  enabledLevelNames,
  levelValues,
  toLevelName,
  toLevelValue,
  type EnabledLogLevelName,
  type LoggerLevel,
} from "./levels";
import { getContext } from "./context";
import { createIntegrationSetupContext, onceTeardown } from "./integration-api";
import { reportLoggerMetaError } from "./meta";
import { runMiddleware } from "./middleware";
import {
  createBoundContext,
  createRecord,
  normalizeCategory,
  recordToEvent,
  type RecordToEventOptions,
} from "./record";
import { valueToMessage } from "./utils/error";
import type {
  ChildLoggerOptions,
  CaptureInput,
  EventDefinition,
  EventLogOptions,
  Integration,
  LogData,
  LogEvent,
  LoggerLike,
  LoggerCategory,
  LoggerOptions,
  Middleware,
  Processor,
  ProcessorContext,
  Tags,
  Transport,
  TransportContext,
} from "./types";

let globalSeq = 0;

interface NormalizedLogArgs {
  msg: string | null;
  lazy: (() => string) | null;
  props: Record<string, unknown> | null;
  err: unknown;
}

function defaultClock() {
  return Date.now();
}

function defaultIdFactory(event: Pick<LogEvent, "time" | "seq" | "levelName" | "logger">): string {
  return `${event.time.toString(36)}-${event.seq.toString(36)}-${event.levelName}`;
}

function levelNameFor(level: LoggerLevel, levelValue: number): EnabledLogLevelName {
  if (typeof level === "string" && enabledLevelNames.includes(level as EnabledLogLevelName)) {
    return level as EnabledLogLevelName;
  }
  return toLevelName(levelValue);
}

function categoryToName(category: LoggerCategory | undefined): string | undefined {
  if (category === undefined) return undefined;
  return normalizeCategory(category).join(".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Error)
  );
}

function dataToProps(data: LogData | undefined): Record<string, unknown> | null {
  if (data === undefined) return null;
  if (isRecord(data)) return data;
  return { value: data };
}

function normalizePropsAndError(data: LogData | undefined): {
  props: Record<string, unknown> | null;
  err: unknown;
} {
  if (data instanceof Error) return { props: null, err: data };
  if (isRecord(data) && data.error instanceof Error) {
    const { error, ...rest } = data;
    return {
      props: Object.keys(rest).length > 0 ? rest : null,
      err: error,
    };
  }
  return { props: dataToProps(data), err: null };
}

function normalizeLogArgs(
  message: unknown,
  data?: LogData | string,
  props?: LogData,
): NormalizedLogArgs {
  if (typeof message === "string") {
    const normalized = normalizePropsAndError(data as LogData | undefined);
    return {
      msg: message,
      lazy: null,
      props: normalized.props,
      err: normalized.err,
    };
  }

  if (typeof message === "function") {
    const normalized = normalizePropsAndError(data as LogData | undefined);
    return {
      msg: null,
      lazy: message as () => string,
      props: normalized.props,
      err: normalized.err,
    };
  }

  const hasExplicitMessage = typeof data === "string";
  const normalized = normalizePropsAndError(
    hasExplicitMessage ? props : (data as LogData | undefined),
  );
  return {
    msg: hasExplicitMessage ? data : valueToMessage(message),
    lazy: null,
    props: normalized.props,
    err: message ?? normalized.err,
  };
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

function mergeRecords(
  ...items: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const item of items) {
    if (!item) continue;
    Object.assign(out, item);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function eventMessage<TPayload extends Record<string, unknown>>(
  definition: EventDefinition<TPayload>,
  payload: TPayload,
  options?: EventLogOptions<TPayload>,
): { msg: string | null; lazy: (() => string) | null } {
  const message = options?.message ?? definition.message;
  if (typeof message === "function") return { msg: null, lazy: () => message(payload) };
  return { msg: message ?? definition.type, lazy: null };
}

function eventTags<TPayload extends Record<string, unknown>>(
  definition: EventDefinition<TPayload>,
  payload: TPayload,
  options?: EventLogOptions<TPayload>,
): Tags | undefined {
  const tags = typeof definition.tags === "function" ? definition.tags(payload) : definition.tags;
  return mergeTags(tags, options?.tags);
}

export class Logger implements LoggerLike {
  readonly name: string;
  private readonly category: readonly string[];
  private minimumLevel: LoggerLevel;
  private minimumLevelValue: number;
  private type?: string;
  private tags?: Tags;
  private bindings?: Record<string, unknown>;
  private middleware: Middleware[];
  private processors: Processor[];
  private transports: Transport[];
  private integrations: Integration[];
  private installedIntegrations = new WeakSet<Integration>();
  private disposers: Array<() => void> = [];
  private contextProvider?: () => Record<string, unknown> | undefined;
  private clock: () => number;
  private idFactory: (event: Pick<LogEvent, "time" | "seq" | "levelName" | "logger">) => string;
  private onInternalError?: (error: unknown, detail?: Record<string, unknown>) => void;
  private closed = false;

  constructor(options: LoggerOptions = {}) {
    this.name = categoryToName(options.category) ?? options.name ?? "app";
    this.category = normalizeCategory(options.category ?? this.name);
    this.minimumLevel = options.level ?? "info";
    this.minimumLevelValue = toLevelValue(this.minimumLevel);
    this.type = options.type;
    this.tags = mergeTags(options.tags);
    this.bindings = mergeRecords(options.bindings);
    this.middleware = [...(options.middleware ?? [])];
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
    this.minimumLevelValue = toLevelValue(level);
  }

  getLevel(): LoggerLevel {
    return this.minimumLevel;
  }

  isEnabled(level: LoggerLevel): boolean {
    return this.isLevelEnabled(level);
  }

  isLevelEnabled(level: LoggerLevel): boolean {
    return toLevelValue(level) >= this.minimumLevelValue;
  }

  child(options: ChildLoggerOptions = {}): Logger {
    return new Logger({
      category: options.category ?? this.category,
      name: categoryToName(options.category) ?? options.name ?? this.name,
      level: options.level ?? this.minimumLevel,
      type: options.type ?? this.type,
      tags: mergeTags(this.tags, options.tags),
      bindings: mergeRecords(this.bindings, options.bindings),
      middleware: [...this.middleware, ...(options.middleware ?? [])],
      processors: [...this.processors, ...(options.processors ?? [])],
      transports: [...this.transports, ...(options.transports ?? [])],
      integrations: options.integrations ?? [],
      contextProvider: this.contextProvider,
      clock: this.clock,
      idFactory: this.idFactory,
      onInternalError: this.onInternalError,
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
    this.setupIntegration(integration);
  }

  log(level: LoggerLevel, message: unknown, data?: LogData | string, props?: LogData) {
    if (this.closed) return;
    const levelValue = toLevelValue(level);
    if (levelValue < this.minimumLevelValue) return;
    const levelName = levelNameFor(level, levelValue);
    const time = this.clock();
    const seq = globalSeq++;
    const context = mergeRecords(getContext(), this.bindings, this.contextProvider?.());
    const normalized = normalizeLogArgs(message, data, props);
    const record = createRecord({
      time,
      level: levelValue,
      category: this.category,
      msg: normalized.msg,
      lazy: normalized.lazy,
      props: normalized.props,
      err: normalized.err,
      ctx: createBoundContext(context),
      source: "app",
      seq,
    });
    this.emitRecord(record, levelName);
  }

  capture(input: CaptureInput) {
    if (this.closed) return;
    const hasError = input.error !== undefined && input.error !== null;
    const level = input.level ?? (hasError ? "error" : "info");
    const levelValue = toLevelValue(level);
    if (levelValue < this.minimumLevelValue) return;
    const levelName = levelNameFor(level, levelValue);
    const time = this.clock();
    const seq = globalSeq++;
    const context = mergeRecords(getContext(), this.bindings, this.contextProvider?.());
    const message = input.message;
    const record = createRecord({
      time,
      level: levelValue,
      category: input.category ?? this.category,
      msg:
        typeof message === "string"
          ? message
          : message === undefined && hasError
            ? valueToMessage(input.error)
            : null,
      lazy: typeof message === "function" ? message : null,
      props: input.props ?? null,
      err: input.error ?? null,
      ctx: createBoundContext(context),
      source: input.source ?? "capture",
      stack: input.stack ?? null,
      seq,
    });
    this.emitRecord(record, levelName);
  }

  event<TPayload extends Record<string, unknown>>(
    definition: EventDefinition<TPayload>,
    payload: TPayload,
    options?: EventLogOptions<TPayload>,
  ) {
    if (this.closed) return;
    const level = options?.level ?? definition.level ?? "info";
    const levelValue = toLevelValue(level);
    if (levelValue < this.minimumLevelValue) return;
    const levelName = levelNameFor(level, levelValue);
    const time = this.clock();
    const seq = globalSeq++;
    const context = mergeRecords(getContext(), this.bindings, this.contextProvider?.());
    const message = eventMessage(definition, payload, options);
    const record = createRecord({
      time,
      level: levelValue,
      category: this.category,
      msg: message.msg,
      lazy: message.lazy,
      props: payload,
      ctx: createBoundContext(context),
      source: "app",
      seq,
    });
    this.emitRecord(record, levelName, {
      type: definition.type,
      tags: eventTags(definition, payload, options),
    });
  }

  private emitRecord(
    record: ReturnType<typeof createRecord>,
    levelName: EnabledLogLevelName,
    options: Pick<RecordToEventOptions, "type" | "tags"> = {},
  ) {
    const processedRecord = runMiddleware(record, this.middleware, {
      now: this.clock,
      reportInternalError: (error, detail) => this.reportInternalError(error, detail),
    });
    if (!processedRecord) return;

    let event: LogEvent = recordToEvent(processedRecord, {
      id: "",
      levelName,
      logger: processedRecord.category.join("."),
      type: options.type ?? this.type,
      tags: mergeTags(this.tags, options.tags),
    });
    event.id = this.idFactory(event);

    const processed = this.applyProcessors(event);
    if (!processed) return;
    this.dispatch(processed);
  }

  trace(message: unknown, data?: LogData | string, props?: LogData) {
    this.log("trace", message, data, props);
  }

  debug(message: unknown, data?: LogData | string, props?: LogData) {
    this.log("debug", message, data, props);
  }

  info(message: unknown, data?: LogData | string, props?: LogData) {
    this.log("info", message, data, props);
  }

  warn(message: unknown, data?: LogData | string, props?: LogData) {
    this.log("warn", message, data, props);
  }

  error(message: unknown, data?: LogData | string, props?: LogData) {
    this.log("error", message, data, props);
  }

  fatal(message: unknown, data?: LogData | string, props?: LogData) {
    this.log("fatal", message, data, props);
  }

  captureException(error: unknown, data?: LogData) {
    const payload = isRecord(data) ? { ...data, error } : { value: data, error };
    this.log("error", error instanceof Error ? error.message : "Captured exception", payload);
  }

  async flush() {
    await Promise.all(this.transports.map((transport) => transport.flush?.()));
  }

  flushSync() {
    for (const transport of this.transports) {
      try {
        transport.flushSync?.();
      } catch (error) {
        this.reportInternalError(error, {
          phase: "transport",
          transport: transport.name,
          operation: "flushSync",
        });
      }
    }
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
    await Promise.all(
      this.transports.map((transport) => transport.close?.() ?? transport.flush?.()),
    );
  }

  private installIntegrations() {
    for (const integration of this.integrations) {
      this.setupIntegration(integration);
    }
  }

  private setupIntegration(integration: Integration) {
    if (this.installedIntegrations.has(integration)) return;
    this.installedIntegrations.add(integration);
    try {
      const context = createIntegrationSetupContext({
        name: integration.name,
        logger: this,
        capture: (input) => this.capture(input),
        getLogger: (category) => this.child({ category }),
      });
      const dispose = integration.setup(context);
      if (typeof dispose === "function") this.disposers.push(onceTeardown(dispose));
    } catch (error) {
      this.reportInternalError(error, {
        phase: "integration-setup",
        integration: integration.name,
      });
    }
  }

  private applyProcessors(event: LogEvent): LogEvent | undefined {
    let current = event;
    const context: ProcessorContext = {
      loggerName: this.name,
      now: this.clock,
      reportInternalError: (error, detail) => this.reportInternalError(error, detail),
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
      reportInternalError: (error, detail) => this.reportInternalError(error, detail),
    };

    for (const transport of this.transports) {
      if (transport.minLevel !== undefined && event.level < toLevelValue(transport.minLevel))
        continue;
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
    reportLoggerMetaError(error, detail, this.onInternalError);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}

export { levelValues };
