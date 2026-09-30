import { afterEach, describe, expect, it, vi } from "vitest";
import { recordToEvent, type TransportContext } from "@loggerjs/core";
import { wireEvents } from "../../core/test/fixtures/wire-events";
import { browserHttpTransport } from "../src";

const context: TransportContext = {
  loggerName: "wire",
  now: () => 0,
  toEvent: recordToEvent,
  reportInternalError() {},
};

// Golden files pin the exact requests collectors receive. A change here is a
// wire-protocol change: review the diff, then update with `vitest -u`.
describe("browserHttpTransport wire format", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends canonical events as this exact Fetch request", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = browserHttpTransport({
      url: "https://collector.example/v1/logs",
      headers: { authorization: "Bearer test-token" },
      maxBatchSize: 100,
      flushIntervalMs: 0,
      useBeaconOnPageHide: false,
      fetchFn: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(null, { status: 204 });
      },
    });

    for (const event of wireEvents) transport.log?.(event, context);
    await transport.flush?.();

    expect(requests).toHaveLength(1);
    const [request] = requests;
    const { body, signal: _signal, ...init } = request?.init ?? {};
    await expect(
      `${JSON.stringify({ url: request?.url, ...init }, null, 2)}\n${String(body)}\n`,
    ).toMatchFileSnapshot("./golden/browser-fetch-request.txt");
  });

  it("sends canonical events as this exact Beacon payload", async () => {
    const beacons: Array<{ url: string; data: Blob }> = [];
    vi.stubGlobal("navigator", {
      sendBeacon: (url: string, data: Blob) => {
        beacons.push({ url, data });
        return true;
      },
    });
    const transport = browserHttpTransport({
      url: "https://collector.example/v1/logs",
      maxBatchSize: 100,
      flushIntervalMs: 60_000,
      useBeaconOnPageHide: false,
      fetchFn: async () => new Response(null, { status: 204 }),
    });

    for (const event of wireEvents) transport.log?.(event, context);
    await transport.close?.();

    expect(beacons).toHaveLength(1);
    const [beacon] = beacons;
    await expect(
      `${JSON.stringify({ url: beacon?.url, type: beacon?.data.type }, null, 2)}\n${await beacon?.data.text()}\n`,
    ).toMatchFileSnapshot("./golden/browser-beacon-payload.txt");
  });
});
