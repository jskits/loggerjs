import { describe, expect, it, vi } from "vitest";
import type { Codec, LogEvent, TransportContext } from "@loggerjs/core";
import { workerTransport, type WorkerLike, type WorkerTransportMessage } from "../src";

const textCodec: Codec<string | Uint8Array> = {
  name: "text",
  contentType: "text/plain",
  encode(input) {
    const items = Array.isArray(input) ? input : [input];
    return items
      .map((item) => {
        if ("message" in item) return item.message;
        return item.msg ?? "";
      })
      .join("|");
  },
};

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "test",
  message: "created",
};

function createContext(errors: unknown[] = []): TransportContext {
  return {
    loggerName: "test",
    now: () => 1,
    reportInternalError(error) {
      errors.push(error);
    },
  };
}

describe("workerTransport", () => {
  it("posts encoded Uint8Array payloads with transfer lists", async () => {
    const postMessage = vi.fn<WorkerLike["postMessage"]>();
    const transport = workerTransport({
      worker: { postMessage },
      codec: textCodec,
    });

    await transport.log?.(event, createContext());

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, transferList] = postMessage.mock.calls[0] ?? [];
    const workerMessage = message as WorkerTransportMessage;
    expect(workerMessage).toMatchObject({
      type: "loggerjs:batch",
      codec: "text",
      contentType: "text/plain",
      count: 1,
    });
    expect(workerMessage.payload).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(workerMessage.payload)).toBe("created");
    expect(transferList).toHaveLength(1);
    expect(transferList?.[0]).toBe(workerMessage.payload.buffer);
  });

  it("falls back inline when worker posting fails", async () => {
    const errors: unknown[] = [];
    const logBatch = vi.fn<NonNullable<ReturnType<typeof workerTransport>["logBatch"]>>(
      async () => {},
    );
    const transport = workerTransport({
      worker: {
        postMessage() {
          throw new Error("worker unavailable");
        },
      },
      codec: textCodec,
      fallback: {
        name: "fallback",
        logBatch,
      },
    });

    await transport.log?.(event, createContext(errors));

    expect(logBatch).toHaveBeenCalledWith([event], expect.any(Object));
    expect(errors).toHaveLength(1);
  });

  it("does not expose sync flush", () => {
    const transport = workerTransport({
      worker: {
        postMessage() {},
      },
      codec: textCodec,
    });

    expect(transport.flushSync).toBeUndefined();
  });
});
