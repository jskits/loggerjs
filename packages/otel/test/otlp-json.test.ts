import { describe, expect, it } from "vitest";
import { createRecord } from "@loggerjs/core";
import { otlpJsonCodec } from "../src";

describe("otlpJsonCodec", () => {
  it("accepts LogRecord batches through the compatibility projection", () => {
    const record = createRecord({
      time: 1,
      level: 50,
      category: ["api"],
      msg: "failed",
      seq: 1,
    });

    const payload = JSON.parse(otlpJsonCodec().encode([record]));

    expect(payload.resourceLogs[0].scopeLogs[0].logRecords[0]).toMatchObject({
      severityNumber: 17,
      severityText: "ERROR",
      body: { stringValue: "failed" },
    });
  });
});
