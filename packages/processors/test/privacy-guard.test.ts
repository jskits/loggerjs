import { describe, expect, it, vi } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { privacyGuardProcessor } from "../src/privacy-guard";

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 1,
  reportInternalError() {},
};

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "app",
  message: "user alice@example.com used Bearer abc.def",
  tags: { email: "ops@example.com", route: "/checkout" },
  data: {
    password: "secret",
    publicToken: "public-value",
    card: "4242 4242 4242 4242",
    nested: { email: "buyer@example.com" },
  },
  context: {
    authorization: "Bearer secret.token",
  },
  error: {
    message: "sent to dev@example.com",
  },
};

describe("privacyGuardProcessor", () => {
  it("redacts sensitive keys and built-in value patterns", () => {
    const onRedact = vi.fn<(path: string, reason: string) => void>();
    const processor = privacyGuardProcessor({ allowKeys: ["publicToken"], onRedact });
    const processed = processor(event, context);

    expect(processed).toMatchObject({
      message: "user [REDACTED] used [REDACTED]",
      tags: { email: "[REDACTED]", route: "/checkout" },
      data: {
        password: "[REDACTED]",
        publicToken: "public-value",
        card: "[REDACTED]",
        nested: { email: "[REDACTED]" },
      },
      context: { authorization: "[REDACTED]" },
      error: { message: "sent to [REDACTED]" },
    });
    expect(onRedact).toHaveBeenCalledWith("data.password", "deny-key");
    expect(onRedact).toHaveBeenCalledWith("data.card", "credit-card");
  });

  it("limits depth and string length", () => {
    const processor = privacyGuardProcessor({
      maxDepth: 1,
      maxStringLength: 4,
      truncateSuffix: "~",
    });
    const processed = processor(
      {
        ...event,
        message: "abcdef",
        data: { safe: { tooDeep: true } },
      },
      context,
    );

    expect(processed).toMatchObject({
      message: "abcd~",
      data: { safe: "[REDACTED]" },
    });
  });

  it("can limit processing to selected targets", () => {
    const processor = privacyGuardProcessor({ targets: ["message"] });
    const processed = processor(event, context);

    expect(processed).toMatchObject({
      message: "user [REDACTED] used [REDACTED]",
      data: { password: "secret" },
      context: { authorization: "Bearer secret.token" },
    });
  });

  it("bounds adversarial email-like input before pattern matching", () => {
    const processor = privacyGuardProcessor({
      targets: ["message"],
      maxStringLength: 128,
      truncateSuffix: "~",
    });
    const startedAt = performance.now();
    const processed = processor(
      {
        ...event,
        message: `prefix a@${"a.".repeat(32_768)}!`,
      },
      context,
    );
    const elapsedMs = performance.now() - startedAt;

    expect(processed).toBeTruthy();
    if (!processed) throw new Error("privacy guard unexpectedly dropped");
    expect(processed.message.endsWith("~")).toBe(true);
    expect(processed.message.length).toBeLessThanOrEqual(129);
    expect(elapsedMs).toBeLessThan(100);
  });
});
