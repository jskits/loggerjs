import { safeJsonStringify, type EnabledLogLevelName, type LogEvent } from "@loggerjs/core";

export type PrettyColorMode = "auto" | "always" | "never";
export type PrettyRenderMode = "compact" | "expanded";
export type PrettyTimeFormat = "iso" | "local" | "time" | "none" | ((event: LogEvent) => string);

export interface PrettyLevelStyle {
  label: string;
  ansi: string;
  css: string;
}

export type PrettyLevelStyles = Partial<Record<EnabledLogLevelName, Partial<PrettyLevelStyle>>>;

export interface PrettyFormatterOptions {
  colors?: PrettyColorMode;
  mode?: PrettyRenderMode;
  time?: PrettyTimeFormat;
  includeLogger?: boolean;
  includeType?: boolean;
  includeTags?: boolean;
  includeData?: boolean;
  includeError?: boolean;
  includeContext?: boolean;
  includeTrace?: boolean;
  includeSource?: boolean;
  includeId?: boolean;
  maxInlineLength?: number;
  maxObjectDepth?: number;
  maxObjectKeys?: number;
  levelStyles?: PrettyLevelStyles;
}

export interface PrettyDetail {
  key: string;
  value: unknown;
  text: string;
}

export interface PrettyFormattedEvent {
  text: string;
  ansiText: string;
  browserArgs: unknown[];
  details: PrettyDetail[];
}

const ansiReset = "\x1b[0m";
const ansiStyles: Record<EnabledLogLevelName, string> = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[34m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m",
};

const cssStyles: Record<EnabledLogLevelName, string> = {
  trace: "color:#6b7280;font-weight:600",
  debug: "color:#0891b2;font-weight:600",
  info: "color:#2563eb;font-weight:600",
  warn: "color:#b45309;font-weight:700",
  error: "color:#dc2626;font-weight:700",
  fatal: "color:#7e22ce;font-weight:800",
};

const labels: Record<EnabledLogLevelName, string> = {
  trace: "TRACE",
  debug: "DEBUG",
  info: "INFO ",
  warn: "WARN ",
  error: "ERROR",
  fatal: "FATAL",
};

function levelStyle(
  levelName: EnabledLogLevelName,
  overrides: PrettyLevelStyles | undefined,
): PrettyLevelStyle {
  const override = overrides?.[levelName];
  return {
    label: override?.label ?? labels[levelName],
    ansi: override?.ansi ?? ansiStyles[levelName],
    css: override?.css ?? cssStyles[levelName],
  };
}

function formatTime(event: LogEvent, format: PrettyTimeFormat): string | undefined {
  if (typeof format === "function") return format(event);
  if (format === "none") return undefined;
  const date = new Date(event.time);
  if (format === "iso") return date.toISOString();
  if (format === "local") return date.toLocaleString();
  return date.toISOString().slice(11, 23);
}

function scalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return safeJsonStringify(value, { maxDepth: 2, maxArrayLength: 20, maxObjectKeys: 20 });
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function tagText(tags: LogEvent["tags"], maxInlineLength: number): string | undefined {
  if (!tags) return undefined;
  const entries = Object.entries(tags);
  if (entries.length === 0) return undefined;
  return entries
    .map(([key, value]) => `${key}=${truncate(scalar(value), maxInlineLength)}`)
    .join(" ");
}

function detailText(
  value: unknown,
  options: Pick<PrettyFormatterOptions, "maxObjectDepth" | "maxObjectKeys">,
): string {
  return safeJsonStringify(value, {
    maxDepth: options.maxObjectDepth ?? 4,
    maxArrayLength: 50,
    maxObjectKeys: options.maxObjectKeys ?? 80,
    stable: true,
  });
}

function collectDetails(event: LogEvent, options: PrettyFormatterOptions): PrettyDetail[] {
  const details: PrettyDetail[] = [];
  const push = (key: string, value: unknown) => {
    if (value === undefined) return;
    details.push({ key, value, text: detailText(value, options) });
  };

  if (options.includeData ?? true) push("data", event.data);
  if (options.includeError ?? true) push("error", event.error);
  if (options.includeContext ?? false) push("context", event.context);
  if (options.includeTrace ?? false) push("trace", event.trace);
  if (options.includeSource ?? false) push("source", event.source);
  if (options.includeId ?? false) push("id", event.id);
  return details;
}

function baseSegments(event: LogEvent, options: PrettyFormatterOptions): string[] {
  const maxInlineLength = options.maxInlineLength ?? 160;
  const style = levelStyle(event.levelName, options.levelStyles);
  const segments: string[] = [];
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

function plainBaseLine(event: LogEvent, options: PrettyFormatterOptions): string {
  return `${baseSegments(event, options).join(" ")} ${event.message}`;
}

function compactText(baseLine: string, details: PrettyDetail[], maxInlineLength: number): string {
  if (details.length === 0) return baseLine;
  const suffix = details
    .map((detail) => `${detail.key}=${truncate(detail.text, maxInlineLength)}`)
    .join(" ");
  return `${baseLine} ${suffix}`;
}

function expandedText(baseLine: string, details: PrettyDetail[]): string {
  if (details.length === 0) return baseLine;
  return [baseLine, ...details.map((detail) => `  ${detail.key}: ${detail.text}`)].join("\n");
}

function withAnsi(event: LogEvent, text: string, options: PrettyFormatterOptions): string {
  if (options.colors !== "always") return text;
  const style = levelStyle(event.levelName, options.levelStyles);
  const label = style.label;
  return text.replace(label, `${style.ansi}${label}${ansiReset}`);
}

function browserArgs(event: LogEvent, options: PrettyFormatterOptions, details: PrettyDetail[]) {
  const style = levelStyle(event.levelName, options.levelStyles);
  const segments = baseSegments(event, options);
  const levelIndex = segments.indexOf(style.label);
  const beforeLevel = segments.slice(0, levelIndex).join(" ");
  const afterLevel = segments.slice(levelIndex + 1).join(" ");
  const before = beforeLevel ? `${beforeLevel} ` : "";
  const after = afterLevel ? ` ${afterLevel}` : "";
  const prefixStyle = "color:#6b7280";
  const format = `%c${before}%c${style.label}%c${after} ${event.message}`;
  return [format, prefixStyle, style.css, "", ...details.map((detail) => detail.value)];
}

export function formatPrettyEvent(
  event: LogEvent,
  options: PrettyFormatterOptions = {},
): PrettyFormattedEvent {
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
