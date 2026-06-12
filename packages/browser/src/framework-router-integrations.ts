import {
  normalizeValue,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export interface FrameworkRouterIntegrationOptions {
  level?: LoggerLevel;
  sanitizeUrl?: (url: string) => string;
  includeState?: boolean;
}

export interface NextRouterLike {
  asPath?: string;
  events?: {
    on?: (event: string, listener: (url: string) => void) => void;
    off?: (event: string, listener: (url: string) => void) => void;
  };
}

export interface ReactRouterHistoryLike {
  location?: unknown;
  listen?: (listener: (update: unknown) => void) => void | (() => void);
}

export interface VueRouterLike {
  currentRoute?: unknown;
  afterEach?: (listener: (to: unknown, from: unknown) => void) => void | (() => void);
}

export interface NextRouterIntegrationOptions extends FrameworkRouterIntegrationOptions {
  router: NextRouterLike;
}

export interface ReactRouterIntegrationOptions extends FrameworkRouterIntegrationOptions {
  history: ReactRouterHistoryLike;
}

export interface VueRouterIntegrationOptions extends FrameworkRouterIntegrationOptions {
  router: VueRouterLike;
  framework?: "vue-router" | "nuxt";
}

function routePath(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object") {
    const route = input as {
      fullPath?: string;
      pathname?: string;
      path?: string;
      location?: unknown;
    };
    if (typeof route.fullPath === "string") return route.fullPath;
    if (typeof route.pathname === "string") return route.pathname;
    if (typeof route.path === "string") return route.path;
    if (route.location) return routePath(route.location);
  }
  return "";
}

function emitRouteChange(
  api: IntegrationSetupContext,
  framework: string,
  level: LoggerLevel,
  to: unknown,
  from: unknown,
  options: FrameworkRouterIntegrationOptions,
) {
  const sanitize = options.sanitizeUrl;
  const toPath = sanitize ? sanitize(routePath(to)) : routePath(to);
  const fromPath =
    from === undefined ? undefined : sanitize ? sanitize(routePath(from)) : routePath(from);
  api.capture({
    level,
    message: `${framework} route ${toPath}`,
    props: {
      browser: {
        kind: "framework-route-change",
        framework,
        route: {
          to: toPath,
          from: fromPath,
          state: options.includeState ? normalizeValue(to, { maxDepth: 4 }) : undefined,
        },
      },
    },
  });
}

export function nextRouterIntegration(options: NextRouterIntegrationOptions): Integration {
  const level = options.level ?? "info";
  return {
    name: "next-router",
    setup(api) {
      const router = options.router;
      if (!router.events?.on || !router.events.off) return;
      const onRoute = api.guard((url: string) =>
        emitRouteChange(api, "next", level, url, router.asPath, options),
      );
      router.events.on("routeChangeComplete", onRoute);
      router.events.on("hashChangeComplete", onRoute);
      return () => {
        router.events?.off?.("routeChangeComplete", onRoute);
        router.events?.off?.("hashChangeComplete", onRoute);
      };
    },
  };
}

export function reactRouterIntegration(options: ReactRouterIntegrationOptions): Integration {
  const level = options.level ?? "info";
  return {
    name: "react-router",
    setup(api) {
      let previous = options.history.location;
      const dispose = options.history.listen?.(
        api.guard((update: unknown) => {
          const next = (update as { location?: unknown })?.location ?? update;
          emitRouteChange(api, "react-router", level, next, previous, options);
          previous = next;
        }),
      );
      return typeof dispose === "function" ? dispose : undefined;
    },
  };
}

export function vueRouterIntegration(options: VueRouterIntegrationOptions): Integration {
  const level = options.level ?? "info";
  const framework = options.framework ?? "vue-router";
  return {
    name: framework,
    setup(api) {
      const dispose = options.router.afterEach?.(
        api.guard((to: unknown, from: unknown) =>
          emitRouteChange(api, framework, level, to, from, options),
        ),
      );
      return typeof dispose === "function" ? dispose : undefined;
    },
  };
}

export function nuxtRouterIntegration(
  options: Omit<VueRouterIntegrationOptions, "framework">,
): Integration {
  return vueRouterIntegration({ ...options, framework: "nuxt" });
}
