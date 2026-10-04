import { describe, expect, it } from "vitest";
import {
  createLogger,
  defineEvent,
  jsonCodec,
  memoryTransport,
  ndjsonCodec,
  safeJsonCodec,
  withContext,
  type LogEvent,
} from "../src";
import { WIRE_TIME, wireEvents } from "./fixtures/wire-events";

// seq comes from a process-wide counter and stacks depend on the runtime,
// so normalize both; everything else is part of the wire shape.
const normalize = (event: LogEvent, index: number): LogEvent =>
  JSON.parse(
    JSON.stringify({ ...event, seq: index }, (key, value: unknown) =>
      key === "stack" ? "<stack>" : value,
    ),
  ) as LogEvent;

// Golden files pin the exact bytes collectors receive. A change here is a
// wire-protocol change: review the diff, then update with `vitest -u`.
describe("wire format", () => {
  it("encodes canonical events with jsonCodec", async () => {
    await expect(jsonCodec().encode(wireEvents)).toMatchFileSnapshot("./golden/json-codec.json");
  });

  it("encodes canonical events with safeJsonCodec", async () => {
    await expect(safeJsonCodec().encode(wireEvents)).toMatchFileSnapshot(
      "./golden/safe-json-codec.json",
    );
  });

  it("encodes canonical events with ndjsonCodec", async () => {
    await expect(ndjsonCodec().encode(wireEvents)).toMatchFileSnapshot(
      "./golden/ndjson-codec.ndjson",
    );
  });

  it("pins the event shape the logger produces", async () => {
    const memory = memoryTransport({ name: "memory" });
    let tick = 0;
    const logger = createLogger({
      category: ["app"],
      transports: [memory],
      level: "trace",
      clock: () => WIRE_TIME + tick++,
      idFactory: (event) => `id-${event.levelName}-${event.time - WIRE_TIME}`,
    });
    const OrderCreated = defineEvent<{ orderId: string }>({
      type: "order.created",
      message: (payload) => `order ${payload.orderId}`,
    });
    const error = Object.assign(new TypeError("boom"), { cause: new Error("root cause") });

    logger.trace("trace line");
    logger.info("with data", { count: 2, nested: { ok: true } });
    logger.error("with error", error);
    logger.child({ category: ["child"], tags: { region: "eu" } }).warn("child warning");
    withContext({ requestId: "req-1" }, () => logger.info("in context"));
    logger.event(OrderCreated, { orderId: "ord_1" });

    await expect(`${JSON.stringify(memory.events.map(normalize), null, 2)}\n`).toMatchFileSnapshot(
      "./golden/logger-events.json",
    );
  });
});
