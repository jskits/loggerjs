export const levelValues = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY
} as const;

export type EnabledLogLevelName = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export type LoggerLevelName = EnabledLogLevelName | "silent";
export type LoggerLevel = LoggerLevelName | number;

export const enabledLevelNames: readonly EnabledLogLevelName[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal"
] as const;

export function toLevelValue(level: LoggerLevel | undefined, fallback: number = levelValues.info): number {
  if (level === undefined || level === null) return fallback;
  if (typeof level === "number") return level;
  return levelValues[level] ?? fallback;
}

export function toLevelName(value: number): EnabledLogLevelName {
  if (value >= levelValues.fatal) return "fatal";
  if (value >= levelValues.error) return "error";
  if (value >= levelValues.warn) return "warn";
  if (value >= levelValues.info) return "info";
  if (value >= levelValues.debug) return "debug";
  return "trace";
}

export function isLevelEnabled(level: LoggerLevel, minimumLevel: LoggerLevel): boolean {
  return toLevelValue(level) >= toLevelValue(minimumLevel);
}
