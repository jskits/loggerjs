import {
  normalizeValue,
  type CaptureInput,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export type QueueOperation = "publish" | "consume" | "ack" | "nack" | "other";

export interface QueueClientLike {
  [method: string]: unknown;
}

export interface QueueIntegrationTarget {
  client: QueueClientLike;
  name?: string;
  system?: string;
  queueName?: string;
  methods?: readonly string[];
}

export interface QueueOperationInfo {
  target: string;
  system?: string;
  queueName?: string;
  method: string;
  operation: QueueOperation;
}

export interface QueueIntegrationOptions {
  client?: QueueClientLike;
  targets?: readonly QueueIntegrationTarget[];
  name?: string;
  system?: string;
  queueName?: string;
  methods?: readonly string[];
  captureAll?: boolean;
  captureSuccessful?: boolean;
  minDurationMs?: number;
  sampleRate?: number;
  random?: () => number;
  capturePayload?: boolean;
  getOperation?: (method: string, args: readonly unknown[]) => QueueOperation;
  getQueueName?: (args: readonly unknown[], method: string) => string | undefined;
  getMessageId?: (args: readonly unknown[], method: string) => string | undefined;
  getPayload?: (args: readonly unknown[], method: string) => unknown;
  level?: (durationMs: number, error: unknown, info: QueueOperationInfo) => LoggerLevel;
}

type QueueMethod = (this: unknown, ...args: unknown[]) => unknown;

const defaultMethods = [
  "add",
  "ack",
  "consume",
  "dequeue",
  "nack",
  "process",
  "publish",
  "receive",
  "send",
  "sendToQueue",
] as const;
const defaultRandom = () => Math.random();

function defaultLevel(_durationMs: number, error: unknown): LoggerLevel {
  return error ? "error" : "debug";
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function defaultOperation(method: string): QueueOperation {
  switch (method) {
    case "add":
    case "publish":
    case "send":
    case "sendToQueue":
      return "publish";
    case "consume":
    case "dequeue":
    case "process":
    case "receive":
      return "consume";
    case "ack":
      return "ack";
    case "nack":
      return "nack";
    default:
      return "other";
  }
}

function defaultPayload(args: readonly unknown[]) {
  return typeof args[0] === "string" && args.length > 1 ? args[1] : args[0];
}

function defaultMessageId(args: readonly unknown[]) {
  const payload = defaultPayload(args);
  if (typeof payload !== "object" || payload === null) return undefined;
  const value =
    (payload as { id?: unknown; messageId?: unknown }).messageId ??
    (payload as { id?: unknown }).id;
  return value === undefined ? undefined : String(value);
}

function payloadFor(args: readonly unknown[], method: string, options: QueueIntegrationOptions) {
  if (!options.capturePayload) return undefined;
  const payload = options.getPayload?.(args, method) ?? defaultPayload(args);
  return payload === undefined
    ? undefined
    : normalizeValue(payload, { maxDepth: 4, maxObjectKeys: 80 });
}

export function queueIntegration(options: QueueIntegrationOptions = {}): Integration {
  const targets =
    options.targets ??
    (options.client
      ? [
          {
            client: options.client,
            name: options.name,
            system: options.system,
            queueName: options.queueName,
            methods: options.methods,
          },
        ]
      : []);
  const captureAll = options.captureAll ?? options.captureSuccessful ?? false;
  const sampleRate = options.sampleRate ?? 1;
  const random = options.random ?? defaultRandom;
  const levelFor = options.level ?? defaultLevel;

  const shouldCapture = (durationMs: number, error: unknown) => {
    if (error) return true;
    if (options.minDurationMs !== undefined && durationMs >= options.minDurationMs) return true;
    if (!captureAll) return false;
    return sampleRate >= 1 || random() < sampleRate;
  };

  return {
    name: "queue",
    setup(api: IntegrationSetupContext) {
      const capture = api.guard((input: CaptureInput) => api.capture(input));
      const disposers: Array<() => void> = [];
      let disposed = false;

      const captureResult = (
        info: QueueOperationInfo,
        started: number,
        args: readonly unknown[],
        error: unknown,
      ) => {
        const durationMs = Date.now() - started;
        if (disposed || !shouldCapture(durationMs, error)) return;
        capture({
          level: levelFor(durationMs, error, info),
          message: error
            ? `Queue error ${info.operation} ${info.queueName ?? info.method}`
            : `Queue ${info.operation} ${info.queueName ?? info.method}`,
          error,
          props: {
            queue: {
              kind: info.target,
              system: info.system,
              queueName: info.queueName,
              method: info.method,
              operation: info.operation,
              durationMs,
              messageId: options.getMessageId?.(args, info.method) ?? defaultMessageId(args),
              payload: payloadFor(args, info.method, options),
            },
          },
        });
      };

      for (const target of targets) {
        const methods = target.methods ?? options.methods ?? defaultMethods;
        for (const method of methods) {
          const original = target.client[method];
          if (typeof original !== "function") continue;
          const originalMethod = original as QueueMethod;
          const targetName = target.name ?? options.name ?? "queue";
          const system = target.system ?? options.system;

          target.client[method] = function wrappedQueueMethod(this: unknown, ...args: unknown[]) {
            const started = Date.now();
            const operation = options.getOperation?.(method, args) ?? defaultOperation(method);
            const info: QueueOperationInfo = {
              target: targetName,
              system,
              queueName:
                options.getQueueName?.(args, method) ??
                target.queueName ??
                options.queueName ??
                (typeof args[0] === "string" ? args[0] : undefined),
              method,
              operation,
            };
            try {
              const result = originalMethod.apply(this, args);
              if (isPromiseLike(result)) {
                return result.then(
                  (value) => {
                    captureResult(info, started, args, undefined);
                    return value;
                  },
                  (error) => {
                    captureResult(info, started, args, error);
                    throw error;
                  },
                );
              }
              captureResult(info, started, args, undefined);
              return result;
            } catch (error) {
              captureResult(info, started, args, error);
              throw error;
            }
          };

          disposers.push(() => {
            target.client[method] = originalMethod;
          });
        }
      }

      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      };
    },
  };
}
