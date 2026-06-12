import type { LogEvent, Processor } from "@loggerjs/core";
import { parseStack, type StackFrame } from "./stack-parser";

export interface SymbolicatedStackFrame extends StackFrame {
  original?: StackFrame;
}

export interface SymbolicateStackOptions {
  maxFrames?: number;
  sourceKey?: string;
  target?: "error" | "context";
  key?: string;
  mode?: "annotate" | "replace";
  symbolicate: (frame: StackFrame, event: LogEvent) => StackFrame | undefined;
}

function frameListFromEvent(event: LogEvent, sourceKey: string): StackFrame[] {
  const existing = event.error?.[sourceKey];
  if (Array.isArray(existing)) return existing as StackFrame[];
  const stack = event.error?.stack;
  return stack ? parseStack(stack) : [];
}

function applySymbolication(
  frame: StackFrame,
  event: LogEvent,
  options: Required<Pick<SymbolicateStackOptions, "mode" | "symbolicate">>,
): SymbolicatedStackFrame {
  const original = options.symbolicate(frame, event);
  if (!original) return frame;
  if (options.mode === "replace") return { ...original, raw: frame.raw };
  return { ...frame, original };
}

function writeFrames(
  event: LogEvent,
  target: "error" | "context",
  key: string,
  frames: readonly SymbolicatedStackFrame[],
): LogEvent {
  if (target === "context") {
    return { ...event, context: { ...event.context, [key]: frames } };
  }
  return {
    ...event,
    error: {
      message: event.error?.message ?? event.message,
      ...event.error,
      [key]: frames,
    },
  };
}

export function symbolicateStackProcessor(options: SymbolicateStackOptions): Processor {
  const maxFrames = Math.max(0, Math.floor(options.maxFrames ?? 20));
  const sourceKey = options.sourceKey ?? "frames";
  const target = options.target ?? "error";
  const key = options.key ?? "symbolicatedFrames";
  const mode = options.mode ?? "annotate";

  return (event) => {
    if (maxFrames === 0) return event;
    const frames = frameListFromEvent(event, sourceKey).slice(0, maxFrames);
    if (frames.length === 0) return event;
    return writeFrames(
      event,
      target,
      key,
      frames.map((frame) =>
        applySymbolication(frame, event, { mode, symbolicate: options.symbolicate }),
      ),
    );
  };
}
