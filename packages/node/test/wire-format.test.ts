import { describe, expect, it } from "vitest";
import { recordToEvent, type TransportContext } from "@loggerjs/core";
import { wireEvents } from "../../core/test/fixtures/wire-events";
import { nodeHttpTransport } from "../src";

const context: TransportContext = {
  loggerName: "wire",
  now: () => 0,
  toEvent: recordToEvent,
  reportInternalError() {},
};

// Golden files pin the exact request collectors receive. A change here is a
// wire-protocol change: review the diff, then update with `vitest -u`.
describe("nodeHttpTransport wire format", () => {
  it("sends canonical events as this exact request", async () => {
    const requests: Array<{ url: string; method?: string; headers: unknown; body: unknown }> = [];
    const transport = nodeHttpTransport({
      url: "https://collector.example/v1/logs",
      headers: { authorization: "Bearer test-token" },
      maxBatchSize: 100,
      flushIntervalMs: 0,
      fetchFn: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method,
          headers: init?.headers,
          body: init?.body,
        });
        return new Response(null, { status: 204 });
      },
    });

    for (const event of wireEvents) transport.log?.(event, context);
    await transport.flush?.();

    expect(requests).toHaveLength(1);
    const [request] = requests;
    await expect(
      `${JSON.stringify({ ...request, body: undefined }, null, 2)}\n${String(request?.body)}\n`,
    ).toMatchFileSnapshot("./golden/node-http-request.txt");
  });
});
