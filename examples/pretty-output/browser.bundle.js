/* eslint-disable */
(function () {
  //#region packages/core/src/levels.ts
  const levelValues = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
    silent: Number.POSITIVE_INFINITY,
  };
  const enabledLevelNames = ["trace", "debug", "info", "warn", "error", "fatal"];
  function toLevelValue(level, fallback = levelValues.info) {
    if (level === void 0 || level === null) return fallback;
    if (typeof level === "number") return level;
    return levelValues[level] ?? fallback;
  }
  function toLevelName(value) {
    if (value >= levelValues.fatal) return "fatal";
    if (value >= levelValues.error) return "error";
    if (value >= levelValues.warn) return "warn";
    if (value >= levelValues.info) return "info";
    if (value >= levelValues.debug) return "debug";
    return "trace";
  }
  //#endregion
  //#region packages/core/src/utils/error.ts
  function stackWithLimit(stack, maxStackLines) {
    if (!stack) return void 0;
    if (maxStackLines <= 0) return void 0;
    return stack.split("\n").slice(0, maxStackLines).join("\n");
  }
  function normalizeError(error, options = {}) {
    const maxStackLines = options.maxStackLines ?? 80;
    const includeEnumerableProperties = options.includeEnumerableProperties ?? true;
    if (error instanceof Error) {
      const out = {
        name: error.name,
        message: error.message,
        stack: stackWithLimit(error.stack, maxStackLines),
      };
      const maybeError = error;
      if (maybeError.cause !== void 0) out.cause = maybeError.cause;
      if (maybeError.code !== void 0) out.code = maybeError.code;
      if (includeEnumerableProperties) {
        for (const key of Object.keys(error)) if (!(key in out)) out[key] = error[key];
      }
      return out;
    }
    if (typeof error === "string") return { message: error };
    if (error && typeof error === "object") {
      const record = error;
      return {
        ...record,
        name: typeof record.name === "string" ? record.name : void 0,
        message: typeof record.message === "string" ? record.message : String(error),
        stack:
          typeof record.stack === "string" ? stackWithLimit(record.stack, maxStackLines) : void 0,
      };
    }
    return { message: String(error) };
  }
  function valueToMessage(value) {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.message;
    if (value === void 0) return "undefined";
    if (value === null) return "null";
    try {
      return String(value);
    } catch {
      return "[Unstringifiable]";
    }
  }
  //#endregion
  //#region packages/core/src/record.ts
  const defaultCategory = Object.freeze(["app"]);
  function normalizeCategory(category) {
    if (category === void 0) return defaultCategory;
    if (typeof category === "string") return Object.freeze([category]);
    if (category.length === 0) return defaultCategory;
    return Object.freeze([...category]);
  }
  function createBoundContext(bindings) {
    if (!bindings || Object.keys(bindings).length === 0) return null;
    return Object.freeze({ ...bindings });
  }
  function createRecord(options) {
    return {
      time: options.time,
      level: options.level,
      category: normalizeCategory(options.category),
      type: options.type ?? null,
      tags: options.tags ?? null,
      trace: options.trace ?? null,
      msg: options.msg ?? null,
      lazy: options.lazy ?? null,
      props: options.props ?? null,
      err: options.err ?? null,
      ctx: options.ctx ?? null,
      source: options.source ?? "app",
      stack: options.stack ?? null,
      seq: options.seq,
    };
  }
  function resolveMessage(record) {
    if (record.msg !== null) return record.msg;
    if (!record.lazy) return "";
    try {
      record.msg = record.lazy();
    } catch (error) {
      record.msg = "[loggerjs message resolver failed]";
      if (record.err === null || record.err === void 0) record.err = error;
    } finally {
      record.lazy = null;
    }
    return record.msg;
  }
  let lastIdTime = -1;
  let lastIdTimeSegment = "";
  /**
   * Formats the default `time36-seq36-levelName` id shared by
   * {@link defaultRecordId} and the logger's default id factory.
   */
  function formatDefaultId(time, seq, levelName) {
    if (time !== lastIdTime) {
      lastIdTime = time;
      lastIdTimeSegment = time.toString(36);
    }
    return `${lastIdTimeSegment}-${seq.toString(36)}-${levelName}`;
  }
  /**
   * Derives the id a record receives when it is projected to an event without a
   * configured id factory. Record-aware transports that encode records directly
   * never consult the logger's `idFactory`; they get this id instead. Codecs that
   * stamp ids onto raw records must use this function so both paths agree.
   */
  function defaultRecordId(record, levelName) {
    return formatDefaultId(record.time, record.seq, levelName);
  }
  function sourceForRecord(record) {
    if (record.source === "app") return void 0;
    return { integration: record.source };
  }
  function errorForRecord(record) {
    if (record.err === null || record.err === void 0) return void 0;
    return normalizeError(record.err);
  }
  function recordToEvent(record, options = {}) {
    const levelName = options.levelName ?? toLevelName(record.level);
    return {
      id:
        typeof options.id === "function"
          ? options.id(record, levelName)
          : (options.id ?? defaultRecordId(record, levelName)),
      time: record.time,
      seq: record.seq,
      level: record.level,
      levelName,
      logger: options.logger ?? record.category.join("."),
      message: resolveMessage(record),
      type: options.type ?? record.type ?? void 0,
      tags: options.tags ?? record.tags ?? void 0,
      data: options.data ?? record.props ?? void 0,
      error: options.error ?? errorForRecord(record),
      context: record.ctx ?? void 0,
      trace: options.trace ?? record.trace ?? void 0,
      source: options.source ?? sourceForRecord(record),
    };
  }
  function propsFromEventData(data) {
    if (data === void 0) return null;
    if (data !== null && typeof data === "object" && !Array.isArray(data)) return data;
    return { value: data };
  }
  function categoryFromEventLogger(logger) {
    const category = logger.split(".").filter(Boolean);
    return category.length > 0 ? category : void 0;
  }
  /**
   * Conversion is lossy: a `runtime` source collapses into the record's string
   * source (and projects back as `integration`), and scalar `data` values are
   * wrapped as `{ value }` because record props must be an object. An event
   * without a source maps to the "app" source so a round trip through
   * {@link recordToEvent} leaves the source undefined again.
   */
  function eventToRecord(event) {
    return createRecord({
      time: event.time,
      level: event.level,
      category: categoryFromEventLogger(event.logger),
      type: event.type ?? null,
      tags: event.tags ?? null,
      trace: event.trace ?? null,
      msg: event.message,
      props: propsFromEventData(event.data),
      err: event.error ?? null,
      ctx: createBoundContext(event.context),
      source: event.source?.integration ?? event.source?.runtime ?? "app",
      seq: event.seq,
    });
  }
  const addedProviders = [];
  function mergeContext(...items) {
    const out = {};
    for (const item of items) {
      if (!item) continue;
      Object.assign(out, item);
    }
    return createBoundContext(out) ?? void 0;
  }
  function createStackContextManager() {
    const stack = [];
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
  function getContext() {
    const managed = manager.get();
    if (addedProviders.length === 0) return managed;
    const provided = mergeContext(void 0, ...addedProviders.map((entry) => entry.provider()));
    if (provided === void 0 || provided === null) return managed;
    if (managed === void 0) return createBoundContext(provided) ?? void 0;
    return mergeContext(provided, managed);
  }
  function withContext(context, fn) {
    return manager.with(context, fn);
  }
  //#endregion
  //#region packages/core/src/event-route.ts
  const LOGGERJS_ROUTE = "__loggerjsRoute";
  function getLogEventRoute(event) {
    return event[LOGGERJS_ROUTE];
  }
  function loggerDiagnosticsEnabled(stage) {
    return false;
  }
  function loggerDiagnosticNow() {
    return globalThis.performance?.now?.() ?? Date.now();
  }
  //#endregion
  //#region packages/core/src/meta.ts
  const counters = /* @__PURE__ */ new Map();
  const originalConsoleKey = "__LOGGERJS_ORIGINAL_CONSOLE__";
  function incrementLoggerMetaCounter(name, amount = 1) {
    counters.set(name, (counters.get(name) ?? 0) + amount);
  }
  function counterForDetail(detail) {
    const phase = detail?.phase;
    if (phase === "middleware") return "middleware.errors";
    if (phase === "processor") return "processor.errors";
    if (phase === "transport") return "transport.errors";
    if (phase === "integration-setup") return "integration.errors";
    if (phase === "dispose") return "dispose.errors";
    return "internal.errors";
  }
  function getConsoleError() {
    return globalThis[originalConsoleKey]?.error ?? console.error.bind(console);
  }
  function reportLoggerMetaError(error, detail, handler) {
    incrementLoggerMetaCounter(counterForDetail(detail));
    if (handler)
      try {
        handler(error, detail);
        return;
      } catch {
        incrementLoggerMetaCounter("internal.handler_errors");
      }
    try {
      getConsoleError()("[loggerjs internal error]", error, detail ?? {});
    } catch {
      incrementLoggerMetaCounter("internal.console_errors");
    }
  }
  //#endregion
  //#region packages/core/src/integration-api.ts
  const UNPATCHED_REGISTRY_KEY = "__LOGGERJS_UNPATCHED_REGISTRY__";
  const consoleMethods = ["debug", "error", "info", "log", "trace", "warn"];
  function globalStore() {
    const global = globalThis;
    const existing = global[UNPATCHED_REGISTRY_KEY];
    if (existing) return existing;
    const store = {
      console: {},
      values: /* @__PURE__ */ new Map(),
    };
    global[UNPATCHED_REGISTRY_KEY] = store;
    return store;
  }
  function getUnpatchedRegistry() {
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
      get(key) {
        return store.values.get(key);
      },
      set(key, value) {
        store.values.set(key, value);
        return value;
      },
    };
  }
  function registerUnpatchedDefaults(registry = getUnpatchedRegistry()) {
    if (typeof console !== "undefined") {
      const source = console;
      for (const method of consoleMethods) registry.console[method] ??= source[method];
    }
    return registry;
  }
  function onceTeardown(teardown) {
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      teardown();
    };
  }
  function createIntegrationSetupContext(options) {
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
        options.capture({
          ...input,
          source,
        });
      },
      getLogger: options.getLogger,
      unpatched,
      guard(fn) {
        return function guarded(...args) {
          if (guardDepth > 0) {
            incrementLoggerMetaCounter("integration.dropped");
            incrementLoggerMetaCounter("integration.dropped.reentrant");
            return;
          }
          guardDepth += 1;
          try {
            return fn.apply(this, args);
          } finally {
            guardDepth -= 1;
          }
        };
      },
    };
  }
  //#endregion
  //#region packages/core/src/middleware.ts
  function runMiddleware(record, middleware, context) {
    let current = record;
    for (const item of middleware) {
      if (current === null) return null;
      try {
        current = item.process(current, context);
      } catch (error) {
        context.reportInternalError(error, {
          phase: "middleware",
          middleware: item.name,
        });
      }
    }
    return current;
  }
  //#endregion
  //#region packages/core/src/logger.ts
  let globalSeq = 0;
  function defaultClock() {
    return Date.now();
  }
  function defaultIdFactory(event) {
    return formatDefaultId(event.time, event.seq, event.levelName);
  }
  function levelNameFor(level, levelValue) {
    if (typeof level === "string" && enabledLevelNames.includes(level)) return level;
    return toLevelName(levelValue);
  }
  function categoryToName(category) {
    if (category === void 0) return void 0;
    return normalizeCategory(category).join(".");
  }
  function isRecord(value) {
    return (
      Boolean(value) &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Error)
    );
  }
  function dataToProps(data) {
    if (data === void 0) return null;
    if (isRecord(data)) return data;
    return { value: data };
  }
  function normalizePropsAndError(data) {
    if (data instanceof Error)
      return {
        props: null,
        err: data,
      };
    if (isRecord(data) && data.error instanceof Error) {
      const { error, ...rest } = data;
      return {
        props: Object.keys(rest).length > 0 ? rest : null,
        err: error,
      };
    }
    return {
      props: dataToProps(data),
      err: null,
    };
  }
  function normalizeLogArgs(message, data, props) {
    if (typeof message === "string") {
      const normalized = normalizePropsAndError(data);
      return {
        msg: message,
        lazy: null,
        props: normalized.props,
        err: normalized.err,
      };
    }
    if (typeof message === "function") {
      const normalized = normalizePropsAndError(data);
      return {
        msg: null,
        lazy: message,
        props: normalized.props,
        err: normalized.err,
      };
    }
    const hasExplicitMessage = typeof data === "string";
    const normalized = normalizePropsAndError(hasExplicitMessage ? props : data);
    return {
      msg: hasExplicitMessage ? data : valueToMessage(message),
      lazy: null,
      props: normalized.props,
      err: message ?? normalized.err,
    };
  }
  function mergeTags(...items) {
    const out = {};
    for (const item of items) {
      if (!item) continue;
      for (const [key, value] of Object.entries(item)) if (value !== void 0) out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : void 0;
  }
  function mergeRecords(...items) {
    const out = {};
    for (const item of items) {
      if (!item) continue;
      Object.assign(out, item);
    }
    return Object.keys(out).length > 0 ? out : void 0;
  }
  function transportName(transport, index) {
    return transport.name ?? `transport-${index}`;
  }
  function shouldDispatchEventToTransport(event, transport, index) {
    const route = getLogEventRoute(event);
    if (!route) return true;
    const name = transportName(transport, index);
    if (route.transports && !route.transports.includes(name)) return false;
    if (route.excludeTransports?.includes(name)) return false;
    return true;
  }
  function eventMessage(definition, payload, options) {
    const message = options?.message ?? definition.message;
    if (typeof message === "function")
      return {
        msg: null,
        lazy: () => message(payload),
      };
    return {
      msg: message ?? definition.type,
      lazy: null,
    };
  }
  function eventTags(definition, payload, options) {
    return mergeTags(
      typeof definition.tags === "function" ? definition.tags(payload) : definition.tags,
      options?.tags,
    );
  }
  var Logger = class Logger {
    constructor(options = {}) {
      this.installedIntegrations = /* @__PURE__ */ new WeakSet();
      this.disposers = [];
      this.closed = false;
      this.projectedEvents = /* @__PURE__ */ new WeakMap();
      this.name = categoryToName(options.category) ?? options.name ?? "app";
      this.category = normalizeCategory(options.category ?? this.name);
      this.minimumLevel = options.level ?? "info";
      this.minimumLevelValue = toLevelValue(this.minimumLevel);
      this.type = options.type;
      this.tags = Object.freeze(mergeTags(options.tags));
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
    setLevel(level) {
      this.minimumLevel = level;
      this.minimumLevelValue = toLevelValue(level);
    }
    getLevel() {
      return this.minimumLevel;
    }
    isEnabled(level) {
      return this.isLevelEnabled(level);
    }
    isLevelEnabled(level) {
      return toLevelValue(level) >= this.minimumLevelValue;
    }
    child(options = {}) {
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
    withTags(tags) {
      return this.child({ tags });
    }
    withType(type) {
      return this.child({ type });
    }
    addProcessor(processor) {
      this.processors.push(processor);
    }
    addTransport(transport) {
      this.transports.push(transport);
    }
    addIntegration(integration) {
      this.integrations.push(integration);
      this.setupIntegration(integration);
    }
    log(level, message, data, props) {
      const levelValue = toLevelValue(level);
      if (levelValue < this.minimumLevelValue) return;
      this.logWith(levelValue, levelNameFor(level, levelValue), message, data, props);
    }
    logWith(levelValue, levelName, message, data, props) {
      if (this.closed) return;
      if (levelValue < this.minimumLevelValue) return;
      const time = this.clock();
      const seq = globalSeq++;
      const ambient = getContext();
      const provided = this.contextProvider?.();
      const ctx =
        this.bindings === void 0 && provided === void 0
          ? (ambient ?? null)
          : createBoundContext(mergeRecords(ambient, this.bindings, provided));
      let msg;
      let lazy;
      let recordProps;
      let err;
      if (
        typeof message === "string" &&
        (data === void 0 || (isRecord(data) && !(data.error instanceof Error)))
      ) {
        msg = message;
        lazy = null;
        recordProps = data ?? null;
        err = null;
      } else {
        const normalized = normalizeLogArgs(message, data, props);
        msg = normalized.msg;
        lazy = normalized.lazy;
        recordProps = normalized.props;
        err = normalized.err;
      }
      const record = {
        time,
        level: levelValue,
        category: this.category,
        type: this.type ?? null,
        tags: this.tags ?? null,
        trace: null,
        msg,
        lazy,
        props: recordProps,
        err,
        ctx,
        source: "app",
        stack: null,
        seq,
      };
      this.emitRecord(record, levelName);
    }
    capture(input) {
      if (this.closed) return;
      const hasError = input.error !== void 0 && input.error !== null;
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
        type: this.type ?? null,
        tags: this.tags ?? null,
        msg:
          typeof message === "string"
            ? message
            : message === void 0 && hasError
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
    event(definition, payload, options) {
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
        type: definition.type,
        tags: mergeTags(this.tags, eventTags(definition, payload, options)) ?? null,
        msg: message.msg,
        lazy: message.lazy,
        props: payload,
        ctx: createBoundContext(context),
        source: "app",
        seq,
      });
      this.emitRecord(record, levelName);
    }
    emitRecord(record, levelName) {
      const processedRecord =
        this.middleware.length === 0
          ? record
          : runMiddleware(record, this.middleware, {
              now: this.clock,
              reportInternalError: (error, detail) => this.reportInternalError(error, detail),
            });
      if (!processedRecord) return;
      if (this.processors.length > 0) {
        const processed = this.applyProcessors(this.createEvent(processedRecord, levelName));
        if (!processed) return;
        this.dispatchEvent(processed);
        return;
      }
      this.dispatchRecord(processedRecord);
    }
    trace(message, data, props) {
      this.logWith(levelValues.trace, "trace", message, data, props);
    }
    debug(message, data, props) {
      this.logWith(levelValues.debug, "debug", message, data, props);
    }
    info(message, data, props) {
      this.logWith(levelValues.info, "info", message, data, props);
    }
    warn(message, data, props) {
      this.logWith(levelValues.warn, "warn", message, data, props);
    }
    error(message, data, props) {
      this.logWith(levelValues.error, "error", message, data, props);
    }
    fatal(message, data, props) {
      this.logWith(levelValues.fatal, "fatal", message, data, props);
    }
    captureException(error, data) {
      const payload = isRecord(data)
        ? {
            ...data,
            error,
          }
        : {
            value: data,
            error,
          };
      this.log("error", error instanceof Error ? error.message : "Captured exception", payload);
    }
    async ready() {
      await Promise.all(this.transports.map((transport) => transport.ready?.()));
    }
    async flush() {
      const flushDiagnostics = loggerDiagnosticsEnabled("flush");
      const start = flushDiagnostics ? loggerDiagnosticNow() : void 0;
      if (flushDiagnostics) this.name;
      try {
        await Promise.all(this.transports.map((transport) => transport.flush?.()));
        if (flushDiagnostics && start !== void 0) (this.name, loggerDiagnosticNow() - start);
      } catch (error) {
        if (flushDiagnostics && start !== void 0) (this.name, loggerDiagnosticNow() - start);
        throw error;
      }
    }
    flushSync() {
      const flushDiagnostics = loggerDiagnosticsEnabled("flush");
      const start = flushDiagnostics ? loggerDiagnosticNow() : void 0;
      if (flushDiagnostics) this.name;
      for (const transport of this.transports)
        try {
          transport.flushSync?.();
        } catch (error) {
          if (flushDiagnostics) (this.name, transport.name);
          this.reportInternalError(error, {
            phase: "transport",
            transport: transport.name,
            operation: "flushSync",
          });
        }
      if (flushDiagnostics && start !== void 0) (this.name, loggerDiagnosticNow() - start);
    }
    async close() {
      if (this.closed) return;
      this.closed = true;
      for (const dispose of this.disposers.splice(0))
        try {
          dispose();
        } catch (error) {
          this.reportInternalError(error, { phase: "dispose" });
        }
      await Promise.all(
        this.transports.map((transport) => {
          if (transport.close) return transport.close();
          return transport.flush?.();
        }),
      );
    }
    installIntegrations() {
      for (const integration of this.integrations) this.setupIntegration(integration);
    }
    setupIntegration(integration) {
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
    applyProcessors(event) {
      let current = event;
      const context = {
        loggerName: this.name,
        now: this.clock,
        reportInternalError: (error, detail) => this.reportInternalError(error, detail),
      };
      for (const processor of this.processors)
        try {
          const result = processor(current, context);
          if (result === false) return void 0;
          if (result) current = result;
        } catch (error) {
          this.reportInternalError(error, { phase: "processor" });
        }
      return current;
    }
    createEvent(record, levelName) {
      const event = recordToEvent(record, {
        id: "",
        levelName,
        logger: record.category.join("."),
      });
      event.id = this.idFactory(event);
      return event;
    }
    getTransportContext() {
      return (this.transportContext ??= {
        loggerName: this.name,
        now: this.clock,
        toEvent: (item) => {
          let event = this.projectedEvents.get(item);
          if (event === void 0) {
            event = this.createEvent(item);
            this.projectedEvents.set(item, event);
          }
          return event;
        },
        reportInternalError: (error, detail) => this.reportInternalError(error, detail),
      });
    }
    settleTransport(result, transport, diagnosticStart) {
      if (result && typeof result.then === "function") {
        result.then(
          () => {
            if (diagnosticStart !== void 0)
              (this.name, transport.name, loggerDiagnosticNow() - diagnosticStart);
          },
          (error) => {
            if (diagnosticStart !== void 0)
              (this.name, transport.name, loggerDiagnosticNow() - diagnosticStart);
            this.reportInternalError(error, {
              phase: "transport",
              transport: transport.name,
            });
          },
        );
        return true;
      }
      return false;
    }
    dispatchRecord(record) {
      const context = this.getTransportContext();
      const dispatchDiagnostics = loggerDiagnosticsEnabled("dispatch");
      const transportDiagnostics = loggerDiagnosticsEnabled("transport");
      const dispatchStart = dispatchDiagnostics ? loggerDiagnosticNow() : void 0;
      if (dispatchDiagnostics) (this.name, record.level);
      try {
        for (let index = 0; index < this.transports.length; index += 1) {
          const transport = this.transports[index];
          if (!transport) continue;
          if (transport.minLevel !== void 0 && record.level < toLevelValue(transport.minLevel))
            continue;
          const transportStart = transportDiagnostics ? loggerDiagnosticNow() : void 0;
          if (transportDiagnostics) (this.name, transport.name, record.level);
          try {
            let result = void 0;
            if (transport.write) result = transport.write(record, context);
            else if (transport.writeBatch) result = transport.writeBatch([record], context);
            else if (transport.log) result = transport.log(context.toEvent(record), context);
            else if (transport.logBatch)
              result = transport.logBatch([context.toEvent(record)], context);
            const asyncTransport = this.settleTransport(result, transport, transportStart);
            if (transportDiagnostics && transportStart !== void 0 && !asyncTransport)
              (this.name, transport.name, loggerDiagnosticNow() - transportStart);
          } catch (error) {
            if (transportDiagnostics && transportStart !== void 0)
              (this.name, transport.name, loggerDiagnosticNow() - transportStart);
            this.reportInternalError(error, {
              phase: "transport",
              transport: transport.name,
            });
          }
        }
      } finally {
        if (dispatchDiagnostics && dispatchStart !== void 0)
          (this.name, loggerDiagnosticNow() - dispatchStart);
      }
    }
    dispatchEvent(event) {
      let record;
      const recordForEvent = () => {
        if (record === void 0) {
          record = eventToRecord(event);
          this.projectedEvents.set(record, event);
        }
        return record;
      };
      const context = this.getTransportContext();
      const dispatchDiagnostics = loggerDiagnosticsEnabled("dispatch");
      const transportDiagnostics = loggerDiagnosticsEnabled("transport");
      const dispatchStart = dispatchDiagnostics ? loggerDiagnosticNow() : void 0;
      if (dispatchDiagnostics) (this.name, event.level);
      try {
        for (let index = 0; index < this.transports.length; index += 1) {
          const transport = this.transports[index];
          if (!transport || !shouldDispatchEventToTransport(event, transport, index)) continue;
          if (transport.minLevel !== void 0 && event.level < toLevelValue(transport.minLevel))
            continue;
          const transportStart = transportDiagnostics ? loggerDiagnosticNow() : void 0;
          if (transportDiagnostics) (this.name, transport.name, event.level);
          try {
            let result = void 0;
            if (transport.log) result = transport.log(event, context);
            else if (transport.logBatch) result = transport.logBatch([event], context);
            else if (transport.write) result = transport.write(recordForEvent(), context);
            else if (transport.writeBatch)
              result = transport.writeBatch([recordForEvent()], context);
            const asyncTransport = this.settleTransport(result, transport, transportStart);
            if (transportDiagnostics && transportStart !== void 0 && !asyncTransport)
              (this.name, transport.name, loggerDiagnosticNow() - transportStart);
          } catch (error) {
            if (transportDiagnostics && transportStart !== void 0)
              (this.name, transport.name, loggerDiagnosticNow() - transportStart);
            this.reportInternalError(error, {
              phase: "transport",
              transport: transport.name,
            });
          }
        }
      } finally {
        if (dispatchDiagnostics && dispatchStart !== void 0)
          (this.name, loggerDiagnosticNow() - dispatchStart);
      }
    }
    reportInternalError(error, detail) {
      reportLoggerMetaError(error, detail, this.onInternalError);
    }
  };
  function createLogger(options = {}) {
    return new Logger(options);
  }
  //#endregion
  //#region packages/core/src/utils/safe-stringify.ts
  function normalizeValue(value, options = {}) {
    const maxDepth = options.maxDepth ?? 8;
    const maxArrayLength = options.maxArrayLength ?? 200;
    const maxObjectKeys = options.maxObjectKeys ?? 200;
    const includeStack = options.includeStack ?? true;
    const stable = options.stable ?? false;
    const seen = /* @__PURE__ */ new WeakSet();
    const walk = (input, depth) => {
      if (input === null || input === void 0) return input;
      const type = typeof input;
      if (type === "string" || type === "number" || type === "boolean") return input;
      if (type === "bigint") return input.toString();
      if (type === "symbol") return String(input);
      if (type === "function") return `[Function ${input.name || "anonymous"}]`;
      if (input instanceof Date) return input.toISOString();
      if (input instanceof RegExp) return String(input);
      if (input instanceof Error) {
        const errorOut = {
          name: input.name,
          message: input.message,
        };
        if (includeStack && input.stack) errorOut.stack = input.stack;
        const record = input;
        for (const key of Object.keys(record)) errorOut[key] = record[key];
        return walk(errorOut, depth + 1);
      }
      if (typeof input !== "object") return String(input);
      if (seen.has(input)) return "[Circular]";
      if (depth >= maxDepth) return "[MaxDepth]";
      seen.add(input);
      if (Array.isArray(input)) {
        const out = [];
        const length = Math.min(input.length, maxArrayLength);
        for (let i = 0; i < length; i += 1) out.push(walk(input[i], depth + 1));
        if (input.length > maxArrayLength)
          out.push(`[Truncated ${input.length - maxArrayLength} items]`);
        return out;
      }
      if (input instanceof Map) return walk(Object.fromEntries(input), depth + 1);
      if (input instanceof Set) return walk(Array.from(input), depth + 1);
      const record = input;
      const keys = Object.keys(record);
      if (stable) keys.sort();
      const out = {};
      const length = Math.min(keys.length, maxObjectKeys);
      for (let i = 0; i < length; i += 1) {
        const key = keys[i];
        out[key] = walk(record[key], depth + 1);
      }
      if (keys.length > maxObjectKeys) out["__truncatedKeys"] = keys.length - maxObjectKeys;
      return out;
    };
    return walk(value, 0);
  }
  function safeJsonStringify(value, options = {}) {
    return JSON.stringify(normalizeValue(value, options), null, options.space);
  }
  //#endregion
  //#region packages/pretty/src/formatter.ts
  const ansiReset = "\x1B[0m";
  const ansiStyles = {
    trace: "\x1B[90m",
    debug: "\x1B[36m",
    info: "\x1B[34m",
    warn: "\x1B[33m",
    error: "\x1B[31m",
    fatal: "\x1B[35m",
  };
  const cssStyles = {
    trace: "color:#6b7280;font-weight:600",
    debug: "color:#0891b2;font-weight:600",
    info: "color:#2563eb;font-weight:600",
    warn: "color:#b45309;font-weight:700",
    error: "color:#dc2626;font-weight:700",
    fatal: "color:#7e22ce;font-weight:800",
  };
  const labels = {
    trace: "TRACE",
    debug: "DEBUG",
    info: "INFO ",
    warn: "WARN ",
    error: "ERROR",
    fatal: "FATAL",
  };
  function levelStyle(levelName, overrides) {
    const override = overrides?.[levelName];
    return {
      label: override?.label ?? labels[levelName],
      ansi: override?.ansi ?? ansiStyles[levelName],
      css: override?.css ?? cssStyles[levelName],
    };
  }
  function formatTime(event, format) {
    if (typeof format === "function") return format(event);
    if (format === "none") return void 0;
    const date = new Date(event.time);
    if (format === "iso") return date.toISOString();
    if (format === "local") return date.toLocaleString();
    return date.toISOString().slice(11, 23);
  }
  function scalar(value) {
    if (value === null) return "null";
    if (value === void 0) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
      return String(value);
    return safeJsonStringify(value, {
      maxDepth: 2,
      maxArrayLength: 20,
      maxObjectKeys: 20,
    });
  }
  function truncate(value, maxLength) {
    if (value.length <= maxLength) return value;
    if (maxLength <= 1) return value.slice(0, maxLength);
    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
  }
  function tagText(tags, maxInlineLength) {
    if (!tags) return void 0;
    const entries = Object.entries(tags);
    if (entries.length === 0) return void 0;
    return entries
      .map(([key, value]) => `${key}=${truncate(scalar(value), maxInlineLength)}`)
      .join(" ");
  }
  function detailText$1(value, options) {
    return safeJsonStringify(value, {
      maxDepth: options.maxObjectDepth ?? 4,
      maxArrayLength: 50,
      maxObjectKeys: options.maxObjectKeys ?? 80,
      stable: true,
    });
  }
  function collectDetails(event, options) {
    const details = [];
    const push = (key, value) => {
      if (value === void 0) return;
      details.push({
        key,
        value,
        text: detailText$1(value, options),
      });
    };
    if (options.includeData ?? true) push("data", event.data);
    if (options.includeError ?? true) push("error", event.error);
    if (options.includeContext ?? false) push("context", event.context);
    if (options.includeTrace ?? false) push("trace", event.trace);
    if (options.includeSource ?? false) push("source", event.source);
    if (options.includeId ?? false) push("id", event.id);
    return details;
  }
  function baseSegments(event, options) {
    const maxInlineLength = options.maxInlineLength ?? 160;
    const style = levelStyle(event.levelName, options.levelStyles);
    const segments = [];
    const time = formatTime(event, options.time ?? "time");
    if (time) segments.push(`[${time}]`);
    segments.push(style.label);
    if (options.includeLogger ?? true) segments.push(event.logger);
    if ((options.includeType ?? true) && event.type) segments.push(`<${event.type}>`);
    if (options.includeTags ?? true) {
      const tags = tagText(event.tags, maxInlineLength);
      if (tags) segments.push(`[${tags}]`);
    }
    return segments;
  }
  function plainBaseLine(event, options) {
    return `${baseSegments(event, options).join(" ")} ${event.message}`;
  }
  function compactText(baseLine, details, maxInlineLength) {
    if (details.length === 0) return baseLine;
    return `${baseLine} ${details.map((detail) => `${detail.key}=${truncate(detail.text, maxInlineLength)}`).join(" ")}`;
  }
  function expandedText(baseLine, details) {
    if (details.length === 0) return baseLine;
    return [baseLine, ...details.map((detail) => `  ${detail.key}: ${detail.text}`)].join("\n");
  }
  function withAnsi(event, text, options) {
    if (options.colors !== "always") return text;
    const style = levelStyle(event.levelName, options.levelStyles);
    const label = style.label;
    return text.replace(label, `${style.ansi}${label}${ansiReset}`);
  }
  function browserArgs(event, options, details) {
    const style = levelStyle(event.levelName, options.levelStyles);
    const segments = baseSegments(event, options);
    const levelIndex = segments.indexOf(style.label);
    const beforeLevel = segments.slice(0, levelIndex).join(" ");
    const afterLevel = segments.slice(levelIndex + 1).join(" ");
    const before = beforeLevel ? `${beforeLevel} ` : "";
    const after = afterLevel ? ` ${afterLevel}` : "";
    return [
      `%c${before}%c${style.label}%c${after} ${event.message}`,
      "color:#6b7280",
      style.css,
      "",
      ...details.map((detail) => detail.value),
    ];
  }
  function formatPrettyEvent(event, options = {}) {
    const maxInlineLength = options.maxInlineLength ?? 160;
    const details = collectDetails(event, options);
    const baseLine = plainBaseLine(event, options);
    const text =
      (options.mode ?? "compact") === "expanded"
        ? expandedText(baseLine, details)
        : compactText(baseLine, details, maxInlineLength);
    return {
      text,
      ansiText: withAnsi(event, text, options),
      browserArgs: browserArgs(event, options, details),
      details,
    };
  }
  //#endregion
  //#region packages/pretty/src/console-transport.ts
  function methodForEvent(event) {
    if (event.levelName === "trace") return "trace";
    if (event.levelName === "debug") return "debug";
    if (event.levelName === "warn") return "warn";
    if (event.levelName === "error" || event.levelName === "fatal") return "error";
    return "info";
  }
  function defaultFilter(event) {
    const integration = event.source?.integration;
    return integration !== "capture-console" && integration !== "integration:capture-console";
  }
  function browserStyleSupport() {
    return typeof window !== "undefined" && typeof document !== "undefined";
  }
  function shouldUseBrowserStyles(value) {
    if (value === void 0 || value === "auto") return browserStyleSupport();
    return value;
  }
  function writerFor(method, target) {
    if (target) return (target[method] ?? target.log ?? target.info ?? (() => {})).bind(target);
    const registry = registerUnpatchedDefaults();
    const fallback = typeof console === "undefined" ? {} : console;
    const writer =
      registry.console[method] ??
      fallback[method] ??
      registry.console.log ??
      fallback.log ??
      (() => {});
    return typeof console === "undefined" ? writer : writer.bind(console);
  }
  function prettyConsoleTransport(options = {}) {
    const filter = options.filter ?? defaultFilter;
    const useBrowserStyles = shouldUseBrowserStyles(options.browserStyles);
    const writeEvent = (event) => {
      if (!filter(event)) return;
      const rendered = formatPrettyEvent(event, options);
      const writer = writerFor(methodForEvent(event), options.console);
      const args = useBrowserStyles
        ? rendered.browserArgs
        : [
            options.colors === "always" ? rendered.ansiText : rendered.text,
            ...rendered.details.map((detail) => detail.value),
          ];
      if (options.includeEvent) args.push(event);
      writer(...args);
    };
    const writeRecord = (record, context) => {
      writeEvent(context.toEvent(record));
    };
    return {
      name: options.name ?? "pretty-console",
      write(record, context) {
        writeRecord(record, context);
      },
      writeBatch(records, context) {
        for (const record of records) writeRecord(record, context);
      },
      log(event) {
        writeEvent(event);
      },
      logBatch(events) {
        for (const event of events) writeEvent(event);
      },
    };
  }
  //#endregion
  //#region examples/pretty-output/browser-demo.js
  const output = document.querySelector("#log-output");
  const status = document.querySelector("#status");
  const emitSample = document.querySelector("#emit-sample");
  const emitError = document.querySelector("#emit-error");
  const clear = document.querySelector("#clear");
  function detailText(value) {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  function appendLine(level, args) {
    const line = document.createElement("article");
    line.className = `log-line ${level}`;
    const text = document.createElement("pre");
    text.className = "line-text";
    text.textContent = String(args[0] ?? "");
    line.append(text);
    for (let i = 1; i < args.length; i += 1) {
      const detail = document.createElement("details");
      const summary = document.createElement("summary");
      const value = document.createElement("pre");
      summary.textContent = `detail ${i}`;
      value.className = "detail-value";
      value.textContent = detailText(args[i]);
      detail.append(summary, value);
      line.append(detail);
    }
    output.append(line);
    output.scrollTop = output.scrollHeight;
  }
  const logger = createLogger({
    name: "pretty-browser-demo",
    level: "trace",
    tags: {
      app: "pretty-output",
      runtime: "browser",
    },
    transports: [
      prettyConsoleTransport({
        name: "page-pretty",
        console: {
          debug: (...args) => appendLine("debug", args),
          info: (...args) => appendLine("info", args),
          log: (...args) => appendLine("info", args),
          trace: (...args) => appendLine("trace", args),
          warn: (...args) => appendLine("warn", args),
          error: (...args) => appendLine("error", args),
        },
        browserStyles: false,
        mode: "expanded",
        includeContext: true,
        includeTrace: true,
      }),
      prettyConsoleTransport({
        name: "devtools-pretty",
        browserStyles: "auto",
        mode: "compact",
        includeContext: false,
      }),
    ],
  });
  function emitSamples() {
    withContext(
      {
        requestId: crypto.randomUUID(),
        view: "browser-demo",
      },
      () => {
        logger.debug("UI control rendered", {
          component: "PrettyOutputDemo",
          controls: ["sample", "error", "clear"],
        });
        logger.info("Checkout page loaded", {
          cartId: "cart_42",
          itemCount: 3,
          currency: "USD",
        });
        logger.warn("API response was slower than budget", {
          route: "/api/checkout/summary",
          durationMs: 842,
          budgetMs: 300,
        });
      },
    );
  }
  function emitFailure() {
    const error = /* @__PURE__ */ new Error("Payment authorization failed");
    logger.error("Payment provider rejected the request", {
      provider: "demo-pay",
      code: "card_declined",
      retryable: false,
      error,
    });
  }
  emitSample.addEventListener("click", emitSamples);
  emitError.addEventListener("click", emitFailure);
  clear.addEventListener("click", () => {
    output.replaceChildren();
  });
  status.textContent = "Ready. Click a button, then also check DevTools console.";
  emitSamples();
  //#endregion
})();
