import { describe, expect, it } from "vitest";
import { formatPrettyEvent, type PrettyFormatterOptions } from "../src";
import type { LogEvent } from "@loggerjs/core";

function event(patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: "evt-1",
    time: Date.UTC(2026, 0, 2, 3, 4, 5, 678),
    seq: 1,
    level: 40,
    levelName: "warn",
    logger: "app.checkout",
    message: "payment retry",
    tags: { tenant: "acme", feature: "billing" },
    data: { orderId: "ord_123", attempt: 2 },
    ...patch,
  };
}

describe("formatPrettyEvent", () => {
  it("renders compact text with logger, type, tags, and structured details", () => {
    const rendered = formatPrettyEvent(
      event({
        type: "payment.retry",
        context: { requestId: "req_1" },
      }),
      { includeContext: true },
    );

    expect(rendered.text).toContain("[03:04:05.678] WARN");
    expect(rendered.text).toContain("app.checkout");
    expect(rendered.text).toContain("<payment.retry>");
    expect(rendered.text).toContain("[tenant=acme feature=billing]");
    expect(rendered.text).toContain("payment retry");
    expect(rendered.text).toContain("data=");
    expect(rendered.text).toContain("context=");
    expect(rendered.details.map((detail) => detail.key)).toEqual(["data", "context"]);
  });

  it("renders expanded text with one detail per line", () => {
    const rendered = formatPrettyEvent(event(), { mode: "expanded" });

    expect(rendered.text).toContain("\n  data:");
    expect(rendered.text).toContain('"orderId":"ord_123"');
  });

  it("renders ANSI only when explicitly requested", () => {
    const plain = formatPrettyEvent(event(), { colors: "never" });
    const colored = formatPrettyEvent(event(), { colors: "always" });

    expect(plain.ansiText).not.toContain("\x1b[");
    expect(colored.ansiText).toContain("\x1b[33mWARN");
  });

  it("returns browser console args that preserve raw detail values", () => {
    const source = event();
    const rendered = formatPrettyEvent(source);

    expect(rendered.browserArgs[0]).toContain("%c");
    expect(rendered.browserArgs).toContain(source.data);
  });

  it("allows level label and color overrides", () => {
    const options: PrettyFormatterOptions = {
      colors: "always",
      levelStyles: {
        warn: {
          label: "CAUTION",
          ansi: "\x1b[95m",
          css: "color:purple",
        },
      },
    };

    const rendered = formatPrettyEvent(event(), options);

    expect(rendered.text).toContain("CAUTION");
    expect(rendered.ansiText).toContain("\x1b[95mCAUTION");
  });
});
