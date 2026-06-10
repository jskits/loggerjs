import { toLevelValue, type LogEvent, type LoggerLevel, type Transport } from "@loggerjs/core";

export type DatadogLogStatus = "debug" | "emergency" | "error" | "info" | "notice" | "warning";

export interface DatadogLogsTransportOptions {
  apiKey?: string;
  site?: string;
  url?: string;
  name?: string;
  minLevel?: LoggerLevel;
  headers?: Record<string, string>;
  service?: string;
  source?: string;
  hostname?: string;
  tags?: Record<string, string | number | boolean | null | undefined> | readonly string[];
  eventTagKeys?: readonly string[];
  message?: (event: LogEvent) => string;
  status?: (event: LogEvent) => DatadogLogStatus | string;
  fetchFn?: typeof fetch;
}

export interface DatadogLogItem {
  message: string;
  status: string;
  timestamp: number;
  service?: string;
  ddsource?: string;
  hostname?: string;
  ddtags?: string;
  logger: {
    name: string;
  };
  loggerjs: Record<string, unknown>;
}

function defaultUrl(site = "datadoghq.com"): string {
  return `https://http-intake.logs.${site}/api/v2/logs`;
}

function defaultStatus(event: LogEvent): DatadogLogStatus {
  if (event.levelName === "warn") return "warning";
  if (event.levelName === "fatal") return "emergency";
  if (event.levelName === "trace") return "debug";
  return event.levelName;
}

function compact<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function tagList(
  event: LogEvent,
  tags: DatadogLogsTransportOptions["tags"],
  eventTagKeys: readonly string[] | undefined,
): string | undefined {
  const out: string[] = [];
  if (Array.isArray(tags)) {
    out.push(...tags);
  } else {
    for (const [key, value] of Object.entries(tags ?? {})) {
      if (value !== undefined && value !== null) out.push(`${key}:${value}`);
    }
  }
  for (const key of eventTagKeys ?? []) {
    const value = event.tags?.[key];
    if (value !== undefined && value !== null) out.push(`${key}:${value}`);
  }
  return out.length > 0 ? out.join(",") : undefined;
}

function loggerjsMetadata(event: LogEvent): Record<string, unknown> {
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

function toDatadogItem(event: LogEvent, options: DatadogLogsTransportOptions): DatadogLogItem {
  const message = options.message ?? ((item: LogEvent) => item.message);
  const status = options.status ?? defaultStatus;
  return compact({
    message: message(event),
    status: status(event),
    timestamp: event.time,
    service: options.service,
    ddsource: options.source,
    hostname: options.hostname,
    ddtags: tagList(event, options.tags, options.eventTagKeys),
    logger: {
      name: event.logger,
    },
    loggerjs: loggerjsMetadata(event),
  });
}

export function datadogLogsTransport(options: DatadogLogsTransportOptions = {}): Transport {
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  const transportName = options.name ?? "datadog-logs";
  const url = options.url ?? defaultUrl(options.site);

  const send = async (events: LogEvent[]) => {
    if (events.length === 0) return;
    if (!fetchFn) throw new Error("fetch is not available for datadogLogsTransport");
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...options.headers,
    };
    if (options.apiKey) headers["dd-api-key"] = options.apiKey;
    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(events.map((event) => toDatadogItem(event, options))),
    });
    if (!response.ok) {
      throw new Error(`datadogLogsTransport failed with status ${response.status}`);
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
