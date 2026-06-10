import {
  type CaptureInput,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export interface CliProcessLike {
  argv?: readonly string[];
  env?: Record<string, string | undefined>;
  exitCode?: number | string | null;
  cwd?: () => string;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => unknown;
}

export interface CaptureCliOptions {
  name?: string;
  process?: CliProcessLike;
  captureStart?: boolean;
  captureExit?: boolean;
  captureSignals?: boolean;
  captureCwd?: boolean;
  captureEnv?: readonly string[];
  signals?: readonly string[];
  level?:
    | LoggerLevel
    | ((event: "start" | "exit" | "signal", code?: number | string) => LoggerLevel);
  getCommand?: (argv: readonly string[]) => string | undefined;
  sanitizeArg?: (arg: string, index: number, argv: readonly string[]) => string;
}

const defaultSignals = ["SIGINT", "SIGTERM"] as const;

function defaultProcess(): CliProcessLike | undefined {
  return (globalThis as unknown as { process?: CliProcessLike }).process;
}

function defaultSanitizeArg(arg: string) {
  if (/^(--?[^=\s]*(token|password|passwd|secret|key)[^=\s]*=)/i.test(arg)) {
    return arg.replace(/=.*/, "=[redacted]");
  }
  return arg;
}

function defaultCommand(argv: readonly string[]): string | undefined {
  return argv[1] ?? argv[0];
}

function levelFor(
  level: CaptureCliOptions["level"],
  event: "start" | "exit" | "signal",
  code?: number | string,
): LoggerLevel {
  if (typeof level === "function") return level(event, code);
  if (level) return level;
  if (event === "signal") return "warn";
  if (event === "exit" && Number(code ?? 0) !== 0) return "error";
  return "info";
}

function pickEnv(
  env: Record<string, string | undefined> | undefined,
  names: readonly string[] | undefined,
) {
  if (!env || !names || names.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = env[name];
    if (value !== undefined) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function removeListener(
  processLike: CliProcessLike,
  event: string,
  listener: (...args: unknown[]) => void,
) {
  if (processLike.off) {
    processLike.off(event, listener);
    return;
  }
  processLike.removeListener?.(event, listener);
}

export function captureCliIntegration(options: CaptureCliOptions = {}): Integration {
  const name = options.name ?? "cli";
  const captureStart = options.captureStart ?? true;
  const captureExit = options.captureExit ?? true;
  const captureSignals = options.captureSignals ?? true;
  const captureCwd = options.captureCwd ?? true;
  const signals = options.signals ?? defaultSignals;
  const sanitizeArg = options.sanitizeArg ?? defaultSanitizeArg;
  const commandFor = options.getCommand ?? defaultCommand;

  return {
    name: "capture-cli",
    setup(api: IntegrationSetupContext) {
      const processLike = options.process ?? defaultProcess();
      if (!processLike) return;
      const argv = processLike.argv ?? [];
      const command = commandFor(argv);
      const sanitizedArgv = argv.map((arg, index) => sanitizeArg(arg, index, argv));
      const disposers: Array<() => void> = [];
      let disposed = false;

      const capture = api.guard((input: CaptureInput) => {
        if (!disposed) api.capture(input);
      });
      const cliBase = {
        kind: name,
        command,
        argv: sanitizedArgv,
        cwd: captureCwd ? processLike.cwd?.() : undefined,
        env: pickEnv(processLike.env, options.captureEnv),
      };

      if (captureStart) {
        capture({
          level: levelFor(options.level, "start"),
          message: `CLI start${command ? ` ${command}` : ""}`,
          props: {
            cli: {
              ...cliBase,
              lifecycle: "start",
            },
          },
        });
      }

      if (captureExit && processLike.on) {
        const onExit = (code: unknown) => {
          const exitCode = code ?? processLike.exitCode ?? 0;
          capture({
            level: levelFor(options.level, "exit", exitCode as number | string),
            message: `CLI exit ${String(exitCode)}`,
            props: {
              cli: {
                ...cliBase,
                lifecycle: "exit",
                exitCode,
              },
            },
          });
        };
        processLike.on("exit", onExit);
        disposers.push(() => removeListener(processLike, "exit", onExit));
      }

      if (captureSignals && processLike.on) {
        for (const signal of signals) {
          const onSignal = () => {
            capture({
              level: levelFor(options.level, "signal", signal),
              message: `CLI signal ${signal}`,
              props: {
                cli: {
                  ...cliBase,
                  lifecycle: "signal",
                  signal,
                },
              },
            });
          };
          processLike.on(signal, onSignal);
          disposers.push(() => removeListener(processLike, signal, onSignal));
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
