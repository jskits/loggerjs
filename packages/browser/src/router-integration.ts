import {
  normalizeValue,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export interface BrowserHistoryLike {
  state?: unknown;
  pushState?: (data: unknown, unused: string, url?: string | URL | null) => unknown;
  replaceState?: (data: unknown, unused: string, url?: string | URL | null) => unknown;
}

export interface BrowserLocationLike {
  href?: string;
  pathname?: string;
  search?: string;
  hash?: string;
}

export type BrowserRouteTrigger =
  | "initial"
  | "pushState"
  | "replaceState"
  | "popstate"
  | "hashchange";
export type BrowserRouteUrlMode = "path" | "href";

export interface BrowserRouteChangePayload {
  trigger: BrowserRouteTrigger;
  from?: string;
  to: string;
  state?: unknown;
}

export interface CaptureRouterOptions {
  level?: LoggerLevel;
  captureInitial?: boolean;
  includeState?: boolean;
  stateMaxDepth?: number;
  urlMode?: BrowserRouteUrlMode;
  sanitizeUrl?: (url: string) => string;
  history?: BrowserHistoryLike;
  location?: BrowserLocationLike;
  addEventListener?: typeof globalThis.addEventListener;
  removeEventListener?: typeof globalThis.removeEventListener;
}

function locationHref(location: BrowserLocationLike | undefined): string {
  if (!location) return "http://localhost/";
  if (location.href) return location.href;
  return `${location.pathname ?? "/"}${location.search ?? ""}${location.hash ?? ""}`;
}

function normalizeRouteUrl(
  url: string | URL | null | undefined,
  location: BrowserLocationLike | undefined,
  mode: BrowserRouteUrlMode,
  sanitizeUrl: ((url: string) => string) | undefined,
): string {
  const fallback = locationHref(location);
  const raw = url === undefined || url === null ? fallback : String(url);
  let normalized = raw;
  try {
    const parsed = new URL(raw, fallback);
    normalized = mode === "href" ? parsed.href : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    normalized = raw;
  }
  return sanitizeUrl ? sanitizeUrl(normalized) : normalized;
}

function routeState(includeState: boolean, state: unknown, maxDepth: number): unknown {
  return includeState ? normalizeValue(state, { maxDepth, maxObjectKeys: 80 }) : undefined;
}

export function captureRouterIntegration(options: CaptureRouterOptions = {}): Integration {
  const level = options.level ?? "info";
  const captureInitial = options.captureInitial ?? true;
  const includeState = options.includeState ?? false;
  const stateMaxDepth = options.stateMaxDepth ?? 4;
  const urlMode = options.urlMode ?? "path";

  return {
    name: "capture-router",
    setup(api: IntegrationSetupContext) {
      const history = options.history ?? globalThis.history;
      const location = options.location ?? globalThis.location;
      const add = options.addEventListener ?? globalThis.addEventListener?.bind(globalThis);
      const remove =
        options.removeEventListener ?? globalThis.removeEventListener?.bind(globalThis);
      const originalPushState = history?.pushState;
      const originalReplaceState = history?.replaceState;
      let current = normalizeRouteUrl(undefined, location, urlMode, options.sanitizeUrl);
      let disposed = false;

      const capture = (trigger: BrowserRouteTrigger, to: string, state?: unknown) => {
        if (disposed) return;
        const previous = current;
        current = to;
        if (trigger !== "initial" && previous === to) return;
        const route: BrowserRouteChangePayload = {
          trigger,
          from: trigger === "initial" ? undefined : previous,
          to,
          state: routeState(includeState, state, stateMaxDepth),
        };
        api.capture({
          level,
          message: trigger === "initial" ? `Route initial ${to}` : `Route change ${to}`,
          props: { browser: { kind: "route-change", route } },
        });
      };

      if (captureInitial) capture("initial", current, history?.state);

      if (history && originalPushState) {
        history.pushState = function pushState(
          data: unknown,
          unused: string,
          url?: string | URL | null,
        ) {
          const result = originalPushState.call(this, data, unused, url);
          capture(
            "pushState",
            normalizeRouteUrl(url, location, urlMode, options.sanitizeUrl),
            data,
          );
          return result;
        };
      }

      if (history && originalReplaceState) {
        history.replaceState = function replaceState(
          data: unknown,
          unused: string,
          url?: string | URL | null,
        ) {
          const result = originalReplaceState.call(this, data, unused, url);
          capture(
            "replaceState",
            normalizeRouteUrl(url, location, urlMode, options.sanitizeUrl),
            data,
          );
          return result;
        };
      }

      const onPopState = api.guard((event: PopStateEvent) => {
        capture(
          "popstate",
          normalizeRouteUrl(undefined, location, urlMode, options.sanitizeUrl),
          event.state,
        );
      });
      const onHashChange = api.guard((event: HashChangeEvent) => {
        capture(
          "hashchange",
          normalizeRouteUrl(event.newURL, location, urlMode, options.sanitizeUrl),
          history?.state,
        );
      });

      add?.("popstate", onPopState);
      add?.("hashchange", onHashChange);

      return () => {
        if (disposed) return;
        disposed = true;
        if (history && originalPushState) history.pushState = originalPushState;
        if (history && originalReplaceState) history.replaceState = originalReplaceState;
        remove?.("popstate", onPopState);
        remove?.("hashchange", onHashChange);
      };
    },
  };
}
