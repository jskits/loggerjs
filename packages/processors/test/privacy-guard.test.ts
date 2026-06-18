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

function cleanEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "evt-clean",
    time: 1,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "app",
    message: "safe",
    ...overrides,
  };
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
            authorization: "Basic opaque-value",
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
      authorization: "[REDACTED]",
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

  it("redacts only Luhn-valid credit card candidates within the supported length range", () => {
    const onRedact = vi.fn<(path: string, reason: string) => void>();
    const processor = privacyGuardProcessor({ targets: ["message"], onRedact });
    const processed = requireEvent(
      processor(
        cleanEvent({
          message:
            "short 123456789012 min 4222222222222 bad 4242424242424241 max 4000000000000000006 long 12345678901234567890",
        }),
        context,
      ),
    );

    expect(processed.message).toBe(
      "short 123456789012 min [REDACTED] bad 4242424242424241 max [REDACTED] long 12345678901234567890",
    );
    expect(onRedact).toHaveBeenCalledTimes(2);
    expect(onRedact).toHaveBeenCalledWith("message", "credit-card");
  });

  it("redacts email boundary cases and leaves invalid domains unchanged", () => {
    const processor = privacyGuardProcessor({ targets: ["message"] });
    const processed = requireEvent(
      processor(
        cleanEvent({
          message:
            "A@z.co z@a.c user@bad..com user@example.c0 foo@bar.x y@example.com_ Z@EXAMPLE.ZZ",
        }),
        context,
      ),
    );

    expect(processed.message).toBe(
      "[REDACTED] z@a.c user@bad..com user@example.c0 foo@bar.x y@example.com_ [REDACTED]",
    );
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

  it("reports max-depth and max-string-length redaction reasons", () => {
    const onRedact = vi.fn<(path: string, reason: string) => void>();
    const processor = privacyGuardProcessor({
      targets: ["message", "data"],
      maxDepth: 1,
      maxStringLength: 4,
      truncateSuffix: "~",
      onRedact,
    });

    processor(
      cleanEvent({
        message: "abcdef",
        data: { nested: { value: "safe" } },
      }),
      context,
    );

    expect(onRedact).toHaveBeenCalledWith("message", "max-string-length");
    expect(onRedact).toHaveBeenCalledWith("data.nested", "max-depth");
  });

  it("uses the default truncate suffix when no suffix is configured", () => {
    const processor = privacyGuardProcessor({
      targets: ["message"],
      maxStringLength: 4,
    });
    const processed = requireEvent(processor({ ...event, message: "abcdef" }, context));

    expect(processed.message).toBe("abcd...");
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

  it("leaves primitive, nullish, and Date-only data unchanged by identity", () => {
    const when = new Date("2026-06-19T00:00:00.000Z");
    const data = {
      count: 1,
      flag: true,
      nothing: null,
      missing: undefined,
      when,
    };
    const input = cleanEvent({ data });
    const processed = privacyGuardProcessor({ targets: ["data"], patterns: [] })(input, context);

    expect(processed).toBe(input);
    expect((processed as LogEvent).data).toBe(data);
    expect((data as { when: Date }).when).toBe(when);
  });

  it("preserves object cycles when cloning guarded data", () => {
    const data: { email: string; self?: unknown } = { email: "buyer@example.com" };
    data.self = data;
    const processed = requireEvent(
      privacyGuardProcessor({ targets: ["data"] })(cleanEvent({ data }), context),
    );
    const guarded = processed.data as typeof data;

    expect(guarded).not.toBe(data);
    expect(guarded.email).toBe("[REDACTED]");
    expect(guarded.self).toBe(guarded);
  });

  it("matches regex deny keys against full nested paths", () => {
    const processor = privacyGuardProcessor({
      targets: ["data"],
      denyKeys: [/^data\.credentials\.value$/],
    });
    const processed = requireEvent(
      processor(
        cleanEvent({ data: { credentials: { value: "secret", label: "public" } } }),
        context,
      ),
    );

    expect(processed.data).toEqual({
      credentials: { value: "[REDACTED]", label: "public" },
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
      message: "user alice@example.com used Bearer abc.def",
      tags: { email: "ops@example.com" },
      data: { secret: "[REDACTED]" },
      context: { authorization: "Bearer secret.token" },
      error: { message: "send to buyer@example.com" },
    });
  });

  it("reports stable redact paths for context, tags, and error targets", () => {
    const onRedact = vi.fn<(path: string, reason: string) => void>();
    const processor = privacyGuardProcessor({ onRedact });

    processor(event, context);

    expect(onRedact).toHaveBeenCalledWith("context.authorization", "deny-key");
    expect(onRedact).toHaveBeenCalledWith("tags.email", "email");
    expect(onRedact).toHaveBeenCalledWith("error.message", "email");
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
