import type { EventDefinition } from "./types";

export type SemanticEventPayload<T extends Record<string, unknown>> = T & Record<string, unknown>;

export type SemanticErrorPayload = SemanticEventPayload<{
  name?: string;
  message: string;
  code?: string | number;
  handled?: boolean;
  fatal?: boolean;
}>;

export type SemanticHttpPayload = SemanticEventPayload<{
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  requestId?: string;
}>;

export type SemanticDbPayload = SemanticEventPayload<{
  system: string;
  operation?: string;
  statement?: string;
  durationMs?: number;
  rows?: number;
}>;

export type SemanticJobPayload = SemanticEventPayload<{
  queue?: string;
  job: string;
  jobId?: string;
  status?: "started" | "completed" | "failed" | "retrying" | string;
  durationMs?: number;
}>;

export type SemanticUiPayload = SemanticEventPayload<{
  component?: string;
  route?: string;
  state?: string;
}>;

export type SemanticActionPayload = SemanticEventPayload<{
  action: string;
  target?: string;
  source?: string;
}>;

export type SemanticSecurityPayload = SemanticEventPayload<{
  category: string;
  outcome?: "allowed" | "denied" | "blocked" | "detected" | string;
  actorId?: string;
  resource?: string;
}>;

export type SemanticPerformancePayload = SemanticEventPayload<{
  metric: string;
  value: number;
  unit?: "ms" | "bytes" | "count" | string;
  target?: string;
}>;

export const semanticEvents = {
  error: {
    type: "error",
    level: "error",
    message: (payload: SemanticErrorPayload) => payload.message,
    tags: { semantic: "error" },
  } satisfies EventDefinition<SemanticErrorPayload>,
  http: {
    type: "http",
    level: "info",
    message: (payload: SemanticHttpPayload) =>
      `HTTP ${payload.status ?? "-"} ${payload.method} ${payload.url}`,
    tags: { semantic: "http" },
  } satisfies EventDefinition<SemanticHttpPayload>,
  db: {
    type: "db",
    level: "debug",
    message: (payload: SemanticDbPayload) =>
      `DB ${payload.system}${payload.operation ? ` ${payload.operation}` : ""}`,
    tags: { semantic: "db" },
  } satisfies EventDefinition<SemanticDbPayload>,
  job: {
    type: "job",
    level: "info",
    message: (payload: SemanticJobPayload) =>
      `Job ${payload.job}${payload.status ? ` ${payload.status}` : ""}`,
    tags: { semantic: "job" },
  } satisfies EventDefinition<SemanticJobPayload>,
  ui: {
    type: "ui",
    level: "info",
    message: (payload: SemanticUiPayload) =>
      `UI ${payload.component ?? payload.route ?? payload.state ?? "event"}`,
    tags: { semantic: "ui" },
  } satisfies EventDefinition<SemanticUiPayload>,
  action: {
    type: "action",
    level: "info",
    message: (payload: SemanticActionPayload) => `Action ${payload.action}`,
    tags: { semantic: "action" },
  } satisfies EventDefinition<SemanticActionPayload>,
  security: {
    type: "security",
    level: "warn",
    message: (payload: SemanticSecurityPayload) =>
      `Security ${payload.category}${payload.outcome ? ` ${payload.outcome}` : ""}`,
    tags: { semantic: "security" },
  } satisfies EventDefinition<SemanticSecurityPayload>,
  performance: {
    type: "performance",
    level: "info",
    message: (payload: SemanticPerformancePayload) =>
      `Performance ${payload.metric} ${payload.value}${payload.unit ?? ""}`,
    tags: { semantic: "performance" },
  } satisfies EventDefinition<SemanticPerformancePayload>,
} as const;
