import { describe, expect, it } from "vitest";
import { createRecord } from "@loggerjs/core";
import { fastEventJsonCodec, msgpackrCodec, projectorCodec } from "../src";

describe("codec adapters", () => {
  it("accepts LogRecord batches through the compatibility projection", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      category: ["api"],
      msg: "created",
      seq: 1,
    });

    expect(JSON.parse(fastEventJsonCodec().encode([record]))).toMatchObject([
      {
        logger: "api",
        message: "created",
      },
    ]);

    const msgpack = msgpackrCodec({
      pack: (input) => new TextEncoder().encode(JSON.stringify(input)),
      unpack: (payload) => JSON.parse(new TextDecoder().decode(payload)) as unknown,
    });
    expect(JSON.parse(new TextDecoder().decode(msgpack.encode([record])))).toMatchObject([
      {
        logger: "api",
        message: "created",
      },
    ]);

    const projector = projectorCodec({
      name: "test-projector",
      contentType: "application/json",
      project: (input) => input,
      serialize: JSON.stringify,
    });
    expect(JSON.parse(projector.encode([record]) as string)).toMatchObject([
      {
        logger: "api",
        message: "created",
      },
    ]);
  });
});
