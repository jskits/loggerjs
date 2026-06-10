import { toLevelValue, type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";

export type ElasticIndexSelector = string | ((event: LogEvent) => string);
export type ElasticOpType = "create" | "index";

export interface ElasticTransportOptions {
  url: string;
  name?: string;
  minLevel?: LoggerLevel;
  index?: ElasticIndexSelector;
  opType?: ElasticOpType;
  pipeline?: string | ((event: LogEvent) => string | undefined);
  id?: (event: LogEvent) => string | undefined;
  headers?: Record<string, string>;
  apiKey?: string;
  refresh?: boolean | "wait_for";
  checkBulkErrors?: boolean;
  document?: (event: LogEvent) => Record<string, unknown>;
  fetchFn?: typeof fetch;
}

export interface ElasticBulkActionMetadata {
  _index?: string;
  _id?: string;
  pipeline?: string;
}

export type ElasticBulkAction =
  | { create: ElasticBulkActionMetadata }
  | { index: ElasticBulkActionMetadata };

function compact<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function defaultBulkUrl(url: string, refresh: ElasticTransportOptions["refresh"]): string {
  const base = url.endsWith("/_bulk") ? url : `${url.replace(/\/+$/, "")}/_bulk`;
  if (refresh === undefined) return base;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}refresh=${encodeURIComponent(String(refresh))}`;
}

function selectedIndex(event: LogEvent, index: ElasticIndexSelector | undefined) {
  return typeof index === "function" ? index(event) : index;
}

function selectedPipeline(event: LogEvent, pipeline: ElasticTransportOptions["pipeline"]) {
  return typeof pipeline === "function" ? pipeline(event) : pipeline;
}

export function toElasticDocument(event: LogEvent): Record<string, unknown> {
  return compact({
    "@timestamp": new Date(event.time).toISOString(),
    message: event.message,
    log: {
      level: event.levelName,
      logger: event.logger,
    },
    event: {
      action: event.type,
      sequence: event.seq,
    },
    labels: event.tags,
    data: event.data,
    error: event.error,
    trace: event.trace,
    context: event.context,
    loggerjs: {
      id: event.id,
      level: event.level,
      source: event.source,
    },
  });
}

export function createElasticBulkPayload(
  events: readonly LogEvent[],
  options: Pick<ElasticTransportOptions, "document" | "id" | "index" | "opType" | "pipeline"> = {},
): string {
  const lines: string[] = [];
  const opType = options.opType ?? "index";
  const document = options.document ?? toElasticDocument;

  for (const event of events) {
    const metadata = compact({
      _index: selectedIndex(event, options.index),
      _id: options.id?.(event),
      pipeline: selectedPipeline(event, options.pipeline),
    });
    const action: ElasticBulkAction =
      opType === "create" ? { create: metadata } : { index: metadata };
    lines.push(JSON.stringify(action));
    lines.push(JSON.stringify(document(event)));
  }

  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function elasticTransport(options: ElasticTransportOptions): Transport {
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  const transportName = options.name ?? "elastic";
  const url = defaultBulkUrl(options.url, options.refresh);
  const checkBulkErrors = options.checkBulkErrors ?? true;

  const send = async (events: LogEvent[]) => {
    if (events.length === 0) return;
    if (!fetchFn) throw new Error("fetch is not available for elasticTransport");
    const headers: Record<string, string> = {
      "content-type": "application/x-ndjson",
      ...options.headers,
    };
    if (options.apiKey) headers.authorization = `ApiKey ${options.apiKey}`;

    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: createElasticBulkPayload(events, options),
    });
    if (!response.ok) throw new Error(`elasticTransport failed with status ${response.status}`);

    if (checkBulkErrors) {
      const result = (await response.json().catch(() => undefined)) as
        | { errors?: boolean }
        | undefined;
      if (result?.errors) throw new Error("elasticTransport bulk response contains item errors");
    }
  };

  return {
    name: transportName,
    minLevel: options.minLevel,
    log(event) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      return send([event]);
    },
    logBatch(events) {
      const selected =
        options.minLevel === undefined
          ? events
          : events.filter((event) => event.level >= toLevelValue(options.minLevel));
      return send([...selected]);
    },
  };
}
