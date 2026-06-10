import {
  normalizeValue,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export type BrowserFrameworkName = "angular" | "react" | "solid" | "svelte" | "vue" | string;

export interface BrowserFrameworkErrorInfo {
  framework?: BrowserFrameworkName;
  componentName?: string;
  componentStack?: string;
  info?: unknown;
  props?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CaptureFrameworkErrorsOptions {
  name?: string;
  framework?: BrowserFrameworkName;
  level?: LoggerLevel;
  maxPending?: number;
  infoMaxDepth?: number;
  getMessage?: (error: unknown, info: BrowserFrameworkErrorInfo) => string;
}

export interface BrowserFrameworkErrorIntegration extends Integration {
  capture: (error: unknown, info?: BrowserFrameworkErrorInfo | string) => void;
  reactComponentDidCatch: (error: unknown, errorInfo?: { componentStack?: string }) => void;
  vueErrorHandler: (error: unknown, instance?: unknown, info?: string) => void;
  solidErrorHandler: (error: unknown) => void;
  svelteErrorHandler: (error: unknown, info?: BrowserFrameworkErrorInfo | string) => void;
}

interface PendingFrameworkError {
  error: unknown;
  info?: BrowserFrameworkErrorInfo | string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Framework error";
}

function instanceComponentName(instance: unknown): string | undefined {
  const record = instance as
    | {
        constructor?: { name?: string };
        $options?: { name?: string };
        type?: { name?: string; displayName?: string };
      }
    | undefined;
  return (
    record?.$options?.name ??
    record?.type?.displayName ??
    record?.type?.name ??
    record?.constructor?.name
  );
}

function normalizeFrameworkInfo(
  input: BrowserFrameworkErrorInfo | string | undefined,
  fallbackFramework: BrowserFrameworkName,
): BrowserFrameworkErrorInfo {
  if (typeof input === "string") return { framework: fallbackFramework, info: input };
  return { framework: fallbackFramework, ...input };
}

export function captureFrameworkErrorsIntegration(
  options: CaptureFrameworkErrorsOptions = {},
): BrowserFrameworkErrorIntegration {
  const integrationName = options.name ?? "capture-framework-errors";
  const fallbackFramework = options.framework ?? "framework";
  const level = options.level ?? "error";
  const maxPending = Math.max(0, Math.floor(options.maxPending ?? 10));
  const infoMaxDepth = options.infoMaxDepth ?? 6;
  const pending: PendingFrameworkError[] = [];
  let api: IntegrationSetupContext | undefined;
  let started = false;
  let disposed = false;

  const emit = (error: unknown, rawInfo?: BrowserFrameworkErrorInfo | string) => {
    const info = normalizeFrameworkInfo(rawInfo, fallbackFramework);
    const message = options.getMessage?.(error, info) ?? errorMessage(error);
    api?.capture({
      level,
      message,
      error,
      props: {
        browser: {
          kind: "framework-error",
          framework: info.framework,
          componentName: info.componentName,
          componentStack: info.componentStack,
          info: normalizeValue(info.info, { maxDepth: infoMaxDepth, maxObjectKeys: 80 }),
          props: normalizeValue(info.props, { maxDepth: infoMaxDepth, maxObjectKeys: 80 }),
        },
      },
    });
  };

  const capture = (error: unknown, info?: BrowserFrameworkErrorInfo | string) => {
    if (api) {
      emit(error, info);
      return;
    }
    if (started || disposed || pending.length >= maxPending) return;
    pending.push({ error, info });
  };

  const integration: BrowserFrameworkErrorIntegration = {
    name: integrationName,
    setup(nextApi) {
      api = nextApi;
      started = true;
      disposed = false;
      for (const item of pending.splice(0)) emit(item.error, item.info);
      return () => {
        api = undefined;
        disposed = true;
      };
    },
    capture,
    reactComponentDidCatch(error, errorInfo) {
      capture(error, {
        framework: "react",
        componentStack: errorInfo?.componentStack,
      });
    },
    vueErrorHandler(error, instance, info) {
      capture(error, {
        framework: "vue",
        componentName: instanceComponentName(instance),
        info,
      });
    },
    solidErrorHandler(error) {
      capture(error, { framework: "solid" });
    },
    svelteErrorHandler(error, info) {
      capture(error, normalizeFrameworkInfo(info, "svelte"));
    },
  };

  return integration;
}
