import type { LogEvent } from "../../src";

// Canonical events for wire-format golden tests. Collectors parse these
// bytes, so any change to how they encode is a wire-protocol change and must
// show up as a reviewed diff of the golden files under test/golden/.
export const WIRE_TIME = Date.UTC(2026, 0, 2, 3, 4, 5, 678);

export const wireEvents: LogEvent[] = [
  {
    id: "evt-minimal",
    time: WIRE_TIME,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "app",
    message: "server started",
  },
  {
    id: "evt-data",
    time: WIRE_TIME + 1,
    seq: 2,
    level: 20,
    levelName: "debug",
    logger: "app.orders",
    message: "order created",
    type: "order.created",
    tags: { region: "eu-west-1", canary: true, shard: 7 },
    data: {
      orderId: "ord_123",
      amount: -1.5,
      zero: 0,
      items: [{ sku: "A-1", qty: 2 }, null],
      nested: { deep: { flag: false } },
      unicode: "naïve café ✓ 日本",
      tricky: 'quote " backslash \\ newline \n separator   end',
    },
  },
  {
    id: "evt-error",
    time: WIRE_TIME + 2,
    seq: 3,
    level: 50,
    levelName: "error",
    logger: "app.payments",
    message: "charge failed",
    error: {
      name: "PaymentError",
      message: "card declined",
      code: "E_DECLINED",
      stack: "PaymentError: card declined\n    at charge (payments.ts:10:5)",
      cause: { name: "Error", message: "gateway timeout" },
    },
  },
  {
    id: "evt-context",
    time: WIRE_TIME + 3,
    seq: 4,
    level: 40,
    levelName: "warn",
    logger: "web",
    message: "slow request",
    context: { requestId: "req-9", userId: 42 },
    trace: {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: "01",
      sampled: true,
    },
    source: { runtime: "node", integration: "express", file: "server.ts", line: 12, column: 3 },
  },
  {
    id: "evt-fatal",
    time: WIRE_TIME + 4,
    seq: 5,
    level: 60,
    levelName: "fatal",
    logger: "app",
    message: "",
    data: [1, "two", { three: 3 }],
  },
];
