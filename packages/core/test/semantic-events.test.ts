import { describe, expect, it } from "vitest";
import { createLogger, memoryTransport, semanticEvents } from "../src";

describe("semanticEvents", () => {
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
