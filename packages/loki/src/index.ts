import { toLevelValue, type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";

export interface LokiTransportOptions {
  url: string;
  name?: string;
  minLevel?: LoggerLevel;
  headers?: Record<string, string>;
  labels?: Record<string, string | number | boolean | null | undefined>;
  labelTags?: readonly string[];
  defaultLabels?: boolean;
  structuredMetadata?: boolean;
  tenantId?: string;
  line?: (event: LogEvent) => string;
  fetchFn?: typeof fetch;
}

export interface LokiPushPayload {
  streams: Array<{
    stream: Record<string, string>;
    values: Array<[string, string] | [string, string, Record<string, unknown>]>;
  }>;
}

function sanitizeLabelName(name: string): string {
  const normalized = name.replace(/[^A-Za-z0-9_]/g, "_");
  if (/^[A-Za-z_]/.test(normalized)) return normalized;
  return `_${normalized}`;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function timestampUnixNs(event: LogEvent): string {
  return (BigInt(Math.trunc(event.time)) * 1_000_000n).toString();
}

function defaultLine(event: LogEvent): string {
  return event.message;
}

function metadataFor(event: LogEvent): Record<string, unknown> {
  return compact({
    id: event.id,
    seq: event.seq,
    logger: event.logger,
    level: event.levelName,
    type: event.type,
    tags: event.tags,
    data: event.data,
    error: event.error,
    context: event.context,
    trace: event.trace,
    source: event.source,
  });
}

function labelEntries(labels: Record<string, string>): string {
  let out = "";
  for (const [key, value] of Object.entries(labels)) out += `${key}=${value}\n`;
  return out;
}

function streamLabels(event: LogEvent, options: LokiTransportOptions): Record<string, string> {
  const labels: Record<string, string> = {};
  if (options.defaultLabels ?? true) {
    labels.level = event.levelName;
    labels.logger = event.logger;
  }
  for (const [key, value] of Object.entries(options.labels ?? {})) {
    if (value !== undefined && value !== null) labels[sanitizeLabelName(key)] = String(value);
  }
  for (const tag of options.labelTags ?? []) {
    const value = event.tags?.[tag];
    if (value !== undefined && value !== null) labels[sanitizeLabelName(tag)] = String(value);
  }
  return labels;
}

function createPayload(events: LogEvent[], options: LokiTransportOptions): LokiPushPayload {
  const streams = new Map<
    string,
    {
      stream: Record<string, string>;
      values: Array<[string, string] | [string, string, Record<string, unknown>]>;
    }
  >();
  const line = options.line ?? defaultLine;
  const includeMetadata = options.structuredMetadata ?? true;

  for (const event of events) {
    const labels = streamLabels(event, options);
    const key = labelEntries(labels);
    let stream = streams.get(key);
    if (!stream) {
      stream = { stream: labels, values: [] };
      streams.set(key, stream);
    }
    const value: [string, string] | [string, string, Record<string, unknown>] = includeMetadata
      ? [timestampUnixNs(event), line(event), metadataFor(event)]
      : [timestampUnixNs(event), line(event)];
    stream.values.push(value);
  }

  return { streams: [...streams.values()] };
}

export function lokiTransport(options: LokiTransportOptions): Transport {
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  const transportName = options.name ?? "loki";

  const send = async (events: LogEvent[]) => {
    if (events.length === 0) return;
    if (!fetchFn) throw new Error("fetch is not available for lokiTransport");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...options.headers,
    };
    if (options.tenantId) headers["x-scope-orgid"] = options.tenantId;
    const response = await fetchFn(options.url, {
      method: "POST",
      headers,
      body: JSON.stringify(createPayload(events, options)),
    });
    if (!response.ok) throw new Error(`lokiTransport failed with status ${response.status}`);
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
