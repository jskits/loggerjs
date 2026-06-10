import {
  normalizeValue,
  type CaptureInput,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export interface DatabaseClientLike {
  [method: string]: unknown;
}

export interface DatabaseIntegrationTarget {
  client: DatabaseClientLike;
  name?: string;
  system?: string;
  methods?: readonly string[];
}

export interface DatabaseOperationInfo {
  target: string;
  system?: string;
  method: string;
  statement?: string;
}

export interface DatabaseIntegrationOptions {
  client?: DatabaseClientLike;
  targets?: readonly DatabaseIntegrationTarget[];
  name?: string;
  system?: string;
  methods?: readonly string[];
  captureAll?: boolean;
  captureSuccessful?: boolean;
  minDurationMs?: number;
  sampleRate?: number;
  random?: () => number;
  captureParameters?: boolean;
  sanitizeStatement?: (statement: string) => string;
  getStatement?: (args: readonly unknown[], method: string) => string | undefined;
  level?: (durationMs: number, error: unknown, info: DatabaseOperationInfo) => LoggerLevel;
}

type DatabaseMethod = (this: unknown, ...args: unknown[]) => unknown;

const defaultMethods = ["query", "execute", "run", "all", "get"] as const;
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

function defaultStatement(args: readonly unknown[]): string | undefined {
  const first = args[0];
  if (typeof first === "string") return first;
  if (typeof first !== "object" || first === null) return undefined;
  const input = first as { sql?: unknown; text?: unknown; query?: unknown };
  if (typeof input.sql === "string") return input.sql;
  if (typeof input.text === "string") return input.text;
  if (typeof input.query === "string") return input.query;
  return undefined;
}

function statementFor(
  args: readonly unknown[],
  method: string,
  options: DatabaseIntegrationOptions,
) {
  const statement = options.getStatement?.(args, method) ?? defaultStatement(args);
  return statement && options.sanitizeStatement ? options.sanitizeStatement(statement) : statement;
}

function parametersFor(args: readonly unknown[], captureParameters: boolean) {
  if (!captureParameters) return undefined;
  const first = args[0];
  const second = args[1];
  const parameters =
    second ??
    (typeof first === "object" && first
      ? ((first as { values?: unknown; params?: unknown; parameters?: unknown }).values ??
        (first as { params?: unknown }).params ??
        (first as { parameters?: unknown }).parameters)
      : undefined);
  return parameters === undefined
    ? undefined
    : normalizeValue(parameters, { maxDepth: 4, maxObjectKeys: 80 });
}

export function databaseIntegration(options: DatabaseIntegrationOptions = {}): Integration {
  const targets =
    options.targets ??
    (options.client
      ? [
          {
            client: options.client,
            name: options.name,
            system: options.system,
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
    name: "database",
    setup(api: IntegrationSetupContext) {
      const capture = api.guard((input: CaptureInput) => api.capture(input));
      const disposers: Array<() => void> = [];
      let disposed = false;

      const captureResult = (
        info: DatabaseOperationInfo,
        started: number,
        args: readonly unknown[],
        error: unknown,
      ) => {
        const durationMs = Date.now() - started;
        if (disposed || !shouldCapture(durationMs, error)) return;
        capture({
          level: levelFor(durationMs, error, info),
          message: error
            ? `Database error ${info.method}${info.statement ? ` ${info.statement}` : ""}`
            : `Database ${info.method}${info.statement ? ` ${info.statement}` : ""}`,
          error,
          props: {
            db: {
              kind: info.target,
              system: info.system,
              method: info.method,
              statement: info.statement,
              durationMs,
              parameters: parametersFor(args, options.captureParameters ?? false),
            },
          },
        });
      };

      for (const target of targets) {
        const methods = target.methods ?? options.methods ?? defaultMethods;
        for (const method of methods) {
          const original = target.client[method];
          if (typeof original !== "function") continue;
          const originalMethod = original as DatabaseMethod;
          const targetName = target.name ?? options.name ?? "database";
          const system = target.system ?? options.system;

          target.client[method] = function wrappedDatabaseMethod(
            this: unknown,
            ...args: unknown[]
          ) {
            const started = Date.now();
            const info: DatabaseOperationInfo = {
              target: targetName,
              system,
              method,
              statement: statementFor(args, method, options),
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
