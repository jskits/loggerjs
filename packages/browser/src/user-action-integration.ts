import type { Integration, IntegrationSetupContext, LoggerLevel } from "@loggerjs/core";

export type BrowserUserActionEventName =
  | "change"
  | "click"
  | "dblclick"
  | "input"
  | "keydown"
  | "submit";

export interface BrowserUserActionTarget {
  tagName?: string;
  id?: string;
  name?: string;
  role?: string;
  type?: string;
  href?: string;
  label?: string;
  text?: string;
  value?: string;
}

export interface BrowserUserActionPayload {
  type: BrowserUserActionEventName | string;
  target: BrowserUserActionTarget;
}

export interface BrowserEventTargetLike {
  addEventListener: typeof globalThis.addEventListener;
  removeEventListener: typeof globalThis.removeEventListener;
}

export interface CaptureUserActionsOptions {
  events?: readonly BrowserUserActionEventName[];
  level?: LoggerLevel;
  listenerCapture?: boolean;
  throttleMs?: number;
  captureText?: boolean;
  captureValue?: boolean;
  maxTextLength?: number;
  labelAttributes?: readonly string[];
  root?: BrowserEventTargetLike;
  clock?: () => number;
  sanitize?: (value: string, field: keyof BrowserUserActionTarget) => string;
  ignore?: (event: Event, target: BrowserUserActionTarget) => boolean;
}

type ElementLike = {
  tagName?: string;
  id?: string;
  name?: string;
  role?: string;
  type?: string;
  href?: string;
  textContent?: string | null;
  value?: string;
  getAttribute?: (name: string) => string | null;
};

const defaultEvents: readonly BrowserUserActionEventName[] = ["click", "input", "change", "submit"];
const defaultLabelAttributes = ["data-loggerjs-label", "aria-label", "name", "id"] as const;

function truncate(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function readAttribute(target: ElementLike, name: string): string | undefined {
  const value = target.getAttribute?.(name);
  return value || undefined;
}

function sanitizeField(
  value: string | undefined,
  field: keyof BrowserUserActionTarget,
  sanitize: CaptureUserActionsOptions["sanitize"],
): string | undefined {
  if (!value) return undefined;
  return sanitize ? sanitize(value, field) : value;
}

function firstLabel(target: ElementLike, attributes: readonly string[]): string | undefined {
  for (const name of attributes) {
    const value = readAttribute(target, name) ?? (target as Record<string, unknown>)[name];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function targetInfo(target: EventTarget | null, options: CaptureUserActionsOptions) {
  const element = target as ElementLike | null;
  if (!element || typeof element !== "object") return {};
  const maxTextLength = options.maxTextLength ?? 120;
  const sanitize = options.sanitize;
  const info: BrowserUserActionTarget = {
    tagName: sanitizeField(element.tagName?.toLowerCase(), "tagName", sanitize),
    id: sanitizeField(element.id, "id", sanitize),
    name: sanitizeField(element.name, "name", sanitize),
    role: sanitizeField(element.role ?? readAttribute(element, "role"), "role", sanitize),
    type: sanitizeField(element.type, "type", sanitize),
    href: sanitizeField(element.href, "href", sanitize),
    label: sanitizeField(
      firstLabel(element, options.labelAttributes ?? defaultLabelAttributes),
      "label",
      sanitize,
    ),
  };

  if (options.captureText) {
    info.text = sanitizeField(
      truncate(element.textContent ?? undefined, maxTextLength),
      "text",
      sanitize,
    );
  }
  if (options.captureValue) {
    info.value = sanitizeField(truncate(element.value, maxTextLength), "value", sanitize);
  }
  return info;
}

function throttleKey(event: Event, target: BrowserUserActionTarget): string {
  return `${event.type}:${target.tagName ?? ""}:${target.id ?? ""}:${target.name ?? ""}:${target.label ?? ""}`;
}

export function captureUserActionsIntegration(
  options: CaptureUserActionsOptions = {},
): Integration {
  const events = options.events ?? defaultEvents;
  const level = options.level ?? "info";
  const listenerCapture = options.listenerCapture ?? true;
  const throttleMs = Math.max(0, Math.floor(options.throttleMs ?? 250));
  const clock = options.clock ?? Date.now;

  return {
    name: "capture-user-actions",
    setup(api: IntegrationSetupContext) {
      const root = options.root ?? globalThis.document;
      if (!root?.addEventListener || !root.removeEventListener) return;
      const lastSeen = new Map<string, number>();
      let disposed = false;

      const onAction = api.guard((event: Event) => {
        if (disposed) return;
        const target = targetInfo(event.target, options);
        if (options.ignore?.(event, target)) return;
        const now = clock();
        const key = throttleKey(event, target);
        const last = lastSeen.get(key) ?? 0;
        if (throttleMs > 0 && now - last < throttleMs) return;
        lastSeen.set(key, now);
        const action: BrowserUserActionPayload = {
          type: event.type,
          target,
        };
        api.capture({
          level,
          message: `User action ${event.type}${target.label ? ` ${target.label}` : ""}`,
          props: { browser: { kind: "user-action", action } },
        });
      });

      for (const event of events) root.addEventListener(event, onAction, listenerCapture);

      return () => {
        if (disposed) return;
        disposed = true;
        for (const event of events) root.removeEventListener(event, onAction, listenerCapture);
      };
    },
  };
}
