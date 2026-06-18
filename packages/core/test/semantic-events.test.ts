import { describe, expect, it } from "vitest";
import { createLogger, memoryTransport, semanticEvents } from "../src";

describe("semanticEvents", () => {
  it("formats every built-in semantic event message", () => {
    expect(semanticEvents.error.message({ message: "boom" })).toBe("boom");
    expect(semanticEvents.http.message({ method: "GET", url: "/orders" })).toBe(
      "HTTP - GET /orders",
    );
    expect(semanticEvents.db.message({ system: "postgres" })).toBe("DB postgres");
    expect(semanticEvents.db.message({ system: "postgres", operation: "query" })).toBe(
      "DB postgres query",
    );
    expect(semanticEvents.job.message({ job: "sync" })).toBe("Job sync");
    expect(semanticEvents.job.message({ job: "sync", status: "failed" })).toBe("Job sync failed");
    expect(semanticEvents.ui.message({ component: "CheckoutButton" })).toBe("UI CheckoutButton");
    expect(semanticEvents.ui.message({ route: "/checkout" })).toBe("UI /checkout");
    expect(semanticEvents.ui.message({ state: "loading" })).toBe("UI loading");
    expect(semanticEvents.ui.message({})).toBe("UI event");
    expect(semanticEvents.action.message({ action: "click", target: "button" })).toBe(
      "Action click",
    );
    expect(semanticEvents.security.message({ category: "auth" })).toBe("Security auth");
    expect(semanticEvents.performance.message({ metric: "heap", value: 42 })).toBe(
      "Performance heap 42",
    );
    expect(semanticEvents.performance.message({ metric: "latency", value: 12, unit: "ms" })).toBe(
      "Performance latency 12ms",
    );
  });

  it("defines stable typed event conventions", () => {
    const transport = memoryTransport();
    const logger = createLogger({ transports: [transport] });

    logger.event(semanticEvents.http, {
      method: "GET",
      url: "/orders",
      status: 503,
      durationMs: 42,
    });
    logger.event(semanticEvents.security, {
      category: "auth",
      outcome: "denied",
      actorId: "user-1",
    });

    expect(transport.events).toMatchObject([
      {
        message: "HTTP 503 GET /orders",
        tags: { semantic: "http" },
        type: "http",
      },
      {
        levelName: "warn",
        message: "Security auth denied",
        tags: { semantic: "security" },
        type: "security",
      },
    ]);
  });
});
