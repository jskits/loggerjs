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

function requireEvent(value: unknown): LogEvent {
  if (!value || typeof value !== "object") {
    throw new Error("privacy guard unexpectedly dropped the event");
  }
  return value as LogEvent;
}

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

  it("covers every default deny-key alias", () => {
    const processor = privacyGuardProcessor();
    const processed = requireEvent(
      processor(
        {
          ...event,
          data: {
            passwd: "p",
            secret: "s",
            token: "t",
            cookie: "c",
            "set-cookie": "sc",
            apiKey: "ak",
            api_key: "snake",
            sessionId: "sid",
          },
        },
        context,
      ),
    );

    expect(processed.data).toEqual({
      passwd: "[REDACTED]",
      secret: "[REDACTED]",
      token: "[REDACTED]",
      cookie: "[REDACTED]",
      "set-cookie": "[REDACTED]",
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
      sessionId: "[REDACTED]",
    });
  });

  it("lets allow-keys override deny-keys for matching keys", () => {
    const processor = privacyGuardProcessor({
      allowKeys: ["password", (_key, path) => path === "data.token"],
    });
    const processed = requireEvent(
      processor(
        {
          ...event,
          data: {
            password: "explicitly allowed",
            token: "allowed by path",
            secret: "blocked",
          },
        },
        context,
      ),
    );

    expect(processed.data).toEqual({
      password: "explicitly allowed",
      token: "allowed by path",
      secret: "[REDACTED]",
    });
  });

  it("redacts bearer tokens with repeated whitespace and reports the built-in reason", () => {
    const onRedact = vi.fn<(path: string, reason: string) => void>();
    const processor = privacyGuardProcessor({ targets: ["message"], onRedact });
    const processed = requireEvent(
      processor(
        {
          ...event,
          message: "Authorization: Bearer   abc.def",
        },
        context,
      ),
    );

    expect(processed.message).toBe("Authorization: [REDACTED]");
    expect(onRedact).toHaveBeenCalledWith("message", "bearer-token");
  });

  it("honors custom pattern validation and replacement", () => {
    const processor = privacyGuardProcessor({
      targets: ["message"],
      patterns: [
        {
          name: "ticket",
          pattern: /\bTICKET-\d+\b/g,
          replacement: "[TICKET]",
          validate: (match) => match.endsWith("42"),
        },
      ],
    });
    const processed = requireEvent(
      processor(
        {
          ...event,
          message: "keep TICKET-1 redact TICKET-42 and leave alice@example.com",
        },
        context,
      ),
    );

    expect(processed.message).toBe("keep TICKET-1 redact [TICKET] and leave alice@example.com");
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

  it("applies max string length again after pattern replacement", () => {
    const processor = privacyGuardProcessor({
      targets: ["message"],
      maxStringLength: 8,
      truncateSuffix: "~",
      patterns: [
        {
          name: "expand",
          pattern: /token/g,
          replacement: "very-long-replacement",
        },
      ],
    });
    const processed = requireEvent(processor({ ...event, message: "token" }, context));

    expect(processed.message).toBe("very-lon~");
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

  it("does not guard error fields when the error target is disabled", () => {
    const processor = privacyGuardProcessor({ targets: ["data"] });
    const processed = processor(
      {
        ...event,
        data: { secret: "hidden" },
        error: { message: "send to buyer@example.com" },
      },
      context,
    );

    expect(processed).toMatchObject({
      data: { secret: "[REDACTED]" },
      error: { message: "send to buyer@example.com" },
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
