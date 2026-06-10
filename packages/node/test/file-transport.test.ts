import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { LogEvent, TransportContext } from "@loggerjs/core";
import { fileTransport } from "../src";

const tempDirs: string[] = [];

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 50,
  levelName: "error",
  logger: "test",
  message: "fatal crash",
};

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  reportInternalError() {},
};

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "loggerjs-file-"));
  tempDirs.push(dir);
  return join(dir, "app.log");
}

describe("fileTransport", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes pending logs through flushSync for crash paths", async () => {
    const path = tempFile();
    const transport = fileTransport({ path });

    transport.log?.(event, context);
    transport.flushSync();

    expect(readFileSync(path, "utf8")).toContain("fatal crash");

    await transport.close?.();
  });
});
