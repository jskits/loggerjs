import { describe, expect, it, vi } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { schemaDevCheckProcessor } from "../src/schema-dev-check";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "app",
  message: "created",
  type: "order.created",
  data: { orderId: "ord-1" },
};

function context() {
  return {
    loggerName: "app",
    now: () => 1,
    reportInternalError: vi.fn<ProcessorContext["reportInternalError"]>(),
  } satisfies ProcessorContext;
}

describe("schemaDevCheckProcessor", () => {
  it("reports invalid events by type without changing the event by default", () => {
    const ctx = context();
    const onInvalid = vi.fn<(item: LogEvent, errors: readonly string[]) => void>();
    const processor = schemaDevCheckProcessor({
      validators: {
        "order.created": (data) =>
          typeof (data as { total?: unknown }).total === "number" ? true : "missing total",
      },
      onInvalid,
    });

    expect(processor(event, ctx)).toBe(event);
    expect(onInvalid).toHaveBeenCalledWith(event, ["missing total"]);
    expect(ctx.reportInternalError).toHaveBeenCalledWith(expect.any(Error), {
      phase: "processor",
      processor: "schema-dev-check",
      eventType: "order.created",
      logger: "app",
    });
  });

  it("can tag invalid events with schema errors", () => {
    const processor = schemaDevCheckProcessor({
      action: "tag",
      validate: () => ["bad order", "missing total"],
      tagKey: "invalid",
      contextKey: "validation",
    });

    expect(processor(event, context())).toMatchObject({
      tags: { invalid: true },
      context: { validation: ["bad order", "missing total"] },
    });
  });

  it("can drop invalid events and skip work when disabled", () => {
    const validate = vi.fn<() => false>(() => false);

    expect(schemaDevCheckProcessor({ action: "drop", validate })(event, context())).toBe(false);
    expect(schemaDevCheckProcessor({ enabled: false, validate })(event, context())).toBe(event);
  });

  it("reports thrown validators and preserves the event", () => {
    const ctx = context();
    const failure = new Error("validator failed");
    const processor = schemaDevCheckProcessor({
      validate: () => {
        throw failure;
      },
    });

    expect(processor(event, ctx)).toBe(event);
    expect(ctx.reportInternalError).toHaveBeenCalledWith(failure, {
      phase: "processor",
      processor: "schema-dev-check",
      eventType: "order.created",
      logger: "app",
    });
  });
});
