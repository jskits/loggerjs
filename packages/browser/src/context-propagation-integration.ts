import {
  addContextProvider,
  formatBaggage,
  formatTraceparent,
  parseBaggage,
  parseTraceparent,
  type Baggage,
  type Integration,
  type TraceContext,
} from "@loggerjs/core";

export type BrowserContextActionEventName = "change" | "click" | "input" | "keydown" | "submit";

export interface BrowserContextEventTargetLike {
  addEventListener: typeof globalThis.addEventListener;
  removeEventListener: typeof globalThis.removeEventListener;
}

export interface BrowserContextPropagationOptions {
  sessionId?: string | (() => string | undefined);
  requestId?: () => string | undefined;
  trace?: TraceContext | (() => TraceContext | undefined);
  traceparent?: string | (() => string | undefined);
  baggage?: Baggage | string | (() => Baggage | string | undefined);
  actionEvents?: readonly BrowserContextActionEventName[];
  actionTtlMs?: number;
  root?: BrowserContextEventTargetLike;
  clock?: () => number;
  idFactory?: () => string;
}

const defaultActionEvents: readonly BrowserContextActionEventName[] = [
  "click",
  "input",
  "change",
  "submit",
];

let fallbackIdSeq = 0;

function defaultIdFactory(): string {
  const cryptoRandomUUID = globalThis.crypto?.randomUUID;
  if (cryptoRandomUUID) return cryptoRandomUUID.call(globalThis.crypto);
  return `${Date.now().toString(36)}-${(fallbackIdSeq++).toString(36)}`;
}

function resolveValue<T>(value: T | (() => T | undefined) | undefined): T | undefined {
  return typeof value === "function" ? (value as () => T | undefined)() : value;
}

function normalizeBaggage(value: Baggage | string | undefined): Baggage | undefined {
  if (typeof value === "string") return parseBaggage(value);
  return value;
}

function actionTargetName(target: EventTarget | null): string | undefined {
  const item = target as { tagName?: string; id?: string; name?: string } | null;
  if (!item) return undefined;
  return item.id || item.name || item.tagName?.toLowerCase();
}

export function browserContextPropagationIntegration(
  options: BrowserContextPropagationOptions = {},
): Integration {
  const actionEvents = options.actionEvents ?? defaultActionEvents;
  const actionTtlMs = Math.max(0, Math.floor(options.actionTtlMs ?? 5000));
  const clock = options.clock ?? Date.now;
  const idFactory = options.idFactory ?? defaultIdFactory;
  let lastAction:
    | {
        id: string;
        type: string;
        target?: string;
        time: number;
      }
    | undefined;

  return {
    name: "browser-context-propagation",
    setup() {
      const root = options.root ?? globalThis.document;
      const disposeProvider = addContextProvider(() => {
        const sessionId = resolveValue(options.sessionId);
        const requestId = options.requestId?.();
        const explicitTrace = resolveValue(options.trace);
        const trace = explicitTrace ?? parseTraceparent(resolveValue(options.traceparent));
        const baggage = normalizeBaggage(resolveValue(options.baggage)) ?? trace?.baggage;
        const traceparent = formatTraceparent(trace);
        const now = clock();
        const action =
          lastAction && now - lastAction.time <= actionTtlMs
            ? {
                actionId: lastAction.id,
                actionType: lastAction.type,
                actionTarget: lastAction.target,
              }
            : undefined;

        return {
          sessionId,
          requestId,
          traceparent,
          baggage: formatBaggage(baggage),
          ...action,
        };
      });

      if (!root?.addEventListener || !root.removeEventListener || actionEvents.length === 0) {
        return disposeProvider;
      }

      const onAction = (event: Event) => {
        lastAction = {
          id: idFactory(),
          type: event.type,
          target: actionTargetName(event.target),
          time: clock(),
        };
      };

      for (const event of actionEvents) root.addEventListener(event, onAction, true);

      return () => {
        for (const event of actionEvents) root.removeEventListener(event, onAction, true);
        disposeProvider();
      };
    },
  };
}
