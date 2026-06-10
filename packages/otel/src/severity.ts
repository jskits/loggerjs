import type { EnabledLogLevelName } from "@loggerjs/core";

export const otelSeverityNumber: Record<EnabledLogLevelName, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21
};

export function otelSeverityText(level: EnabledLogLevelName): string {
  return level.toUpperCase();
}
