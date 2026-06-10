import type { EnabledLogLevelName, LogEvent, Processor } from "@loggerjs/core";

export interface SampleOptions {
  defaultRate?: number;
  rates?: Partial<Record<EnabledLogLevelName, number>>;
  random?: () => number;
}

function clampRate(rate: number): number {
  if (Number.isNaN(rate)) return 1;
  return Math.max(0, Math.min(1, rate));
}

export function sampleProcessor(options: SampleOptions = {}): Processor {
  const defaultRate = clampRate(options.defaultRate ?? 1);
  const random = options.random ?? Math.random;
  const rates = options.rates ?? {};

  return (event: LogEvent): LogEvent | false => {
    const rate = clampRate(rates[event.levelName] ?? defaultRate);
    if (rate >= 1) return event;
    if (rate <= 0) return false;
    return random() < rate ? event : false;
  };
}
