import type { LogEvent, Processor } from "@loggerjs/core";

export interface StackFrame {
  raw?: string;
  function?: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface StackParserOptions {
  maxFrames?: number;
  dropInternal?: boolean;
  includeRaw?: boolean;
  target?: "error" | "context";
  key?: string;
  parser?: (stack: string) => readonly StackFrame[];
}

const V8_FRAME = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const FIREFOX_FRAME = /^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/;

function toNumber(input: string): number | undefined {
  const value = Number(input);
  return Number.isFinite(value) ? value : undefined;
}

function cleanFunctionName(input: string | undefined): string | undefined {
  if (!input || input === "async") return undefined;
  return input.trim() || undefined;
}

function frameFromMatch(raw: string, match: RegExpMatchArray): StackFrame {
  return {
    raw,
    function: cleanFunctionName(match[1]),
    file: match[2],
    line: match[3] ? toNumber(match[3]) : undefined,
    column: match[4] ? toNumber(match[4]) : undefined,
  };
}

function parseLine(raw: string): StackFrame {
  const v8 = raw.match(V8_FRAME);
  if (v8) return frameFromMatch(raw, v8);

  const firefox = raw.match(FIREFOX_FRAME);
  if (firefox) return frameFromMatch(raw, firefox);

  return { raw };
}

function isInternalFrame(frame: StackFrame): boolean {
  const file = frame.file ?? frame.raw ?? "";
  return file.startsWith("node:internal") || file.includes("/node:internal/");
}

function defaultParseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const raw of stack.split("\n")) {
    const line = raw.trim();
    if (!line || !line.includes(":")) continue;
    const frame = parseLine(line);
    if (frame.file || line.startsWith("at ") || line.includes("@")) frames.push(frame);
  }
  return frames;
}

function stripRaw(frame: StackFrame): StackFrame {
  const { raw: _raw, ...rest } = frame;
  return rest;
}

function normalizeFrames(
  frames: readonly StackFrame[],
  options: RequiredStackOptions,
): StackFrame[] {
  const out: StackFrame[] = [];
  for (const frame of frames) {
    if (options.dropInternal && isInternalFrame(frame)) continue;
    out.push(options.includeRaw ? frame : stripRaw(frame));
    if (out.length >= options.maxFrames) break;
  }
  return out;
}

interface RequiredStackOptions {
  maxFrames: number;
  dropInternal: boolean;
  includeRaw: boolean;
  target: "error" | "context";
  key: string;
  parser: (stack: string) => readonly StackFrame[];
}

function writeFrames(
  event: LogEvent,
  options: RequiredStackOptions,
  frames: StackFrame[],
): LogEvent {
  if (options.target === "context") {
    return { ...event, context: { ...event.context, [options.key]: frames } };
  }
  return {
    ...event,
    error: {
      message: event.error?.message ?? event.message,
      ...event.error,
      [options.key]: frames,
    },
  };
}

export function parseStack(stack: string): StackFrame[] {
  return defaultParseStack(stack);
}

export function stackParserProcessor(options: StackParserOptions = {}): Processor {
  const normalized: RequiredStackOptions = {
    maxFrames: Math.max(0, Math.floor(options.maxFrames ?? 20)),
    dropInternal: options.dropInternal ?? false,
    includeRaw: options.includeRaw ?? true,
    target: options.target ?? "error",
    key: options.key ?? "frames",
    parser: options.parser ?? defaultParseStack,
  };

  return (event) => {
    const stack = event.error?.stack;
    if (!stack || normalized.maxFrames === 0) return event;

    const frames = normalizeFrames(normalized.parser(stack), normalized);
    return frames.length > 0 ? writeFrames(event, normalized, frames) : event;
  };
}
