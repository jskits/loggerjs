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

  it("can suppress base segments and structured detail sections", () => {
    const rendered = formatPrettyEvent(
      event({
        context: { requestId: "req_1" },
        error: { name: "Error", message: "failed" },
        source: { integration: "test" },
        trace: { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331" },
      }),
      {
        includeContext: true,
        includeData: false,
        includeError: false,
        includeId: true,
        includeLogger: false,
        includeSource: true,
        includeTags: false,
        includeTrace: true,
        includeType: false,
        time: "none",
      },
    );

    expect(rendered.text).toBe(
      'WARN  payment retry context={"requestId":"req_1"} trace={"spanId":"b7ad6b7169203331","traceId":"0af7651916cd43dd8448eb211c80319c"} source={"integration":"test"} id="evt-1"',
    );
    expect(rendered.details.map((detail) => detail.key)).toEqual([
      "context",
      "trace",
      "source",
      "id",
    ]);
  });

  it("supports local, ISO, and callback time formatters", () => {
    const iso = formatPrettyEvent(event(), { time: "iso" });
    const local = formatPrettyEvent(event(), { time: "local" });
    const custom = formatPrettyEvent(event(), { time: (item) => `seq-${item.seq}` });

    expect(iso.text).toContain("[2026-01-02T03:04:05.678Z]");
    expect(local.text).toContain("[");
    expect(local.text).toContain("WARN");
    expect(custom.text).toContain("[seq-1]");
  });

  it("truncates inline tags and details with very small limits", () => {
    const rendered = formatPrettyEvent(
      event({
        tags: { feature: "very-long-feature-name" },
        data: { value: "very-long-data-value" },
      }),
      { maxInlineLength: 1 },
    );

    expect(rendered.text).toContain("[feature=v]");
    expect(rendered.text).toContain("data={");
  });
});
