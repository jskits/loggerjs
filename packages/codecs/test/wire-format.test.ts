import { describe, expect, it } from "vitest";
import { wireEvents } from "../../core/test/fixtures/wire-events";
import { fastEventJsonCodec, msgpackrCodec, pinoCompatCodec } from "../src";

// Golden files pin the exact bytes collectors receive. A change here is a
// wire-protocol change: review the diff, then update with `vitest -u`.
describe("codec wire format", () => {
  it("encodes canonical events with fastEventJsonCodec", async () => {
    await expect(fastEventJsonCodec().encode(wireEvents)).toMatchFileSnapshot(
      "./golden/fast-event-json.json",
    );
  });

  it("encodes canonical events with pinoCompatCodec", async () => {
    await expect(pinoCompatCodec().encode(wireEvents)).toMatchFileSnapshot(
      "./golden/pino-compat.ndjson",
    );
  });

  it("encodes canonical events with msgpackrCodec", async () => {
    const bytes = msgpackrCodec().encode(wireEvents);
    const hex = Buffer.from(bytes)
      .toString("hex")
      .replace(/(.{64})/g, "$1\n");
    await expect(`${hex}\n`).toMatchFileSnapshot("./golden/msgpackr.hex");
    // The golden bytes must still decode to the canonical events.
    expect(msgpackrCodec().decode?.(bytes)).toEqual(wireEvents);
  });
});
