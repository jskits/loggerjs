import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordToEvent, type LogEvent, type TransportContext } from "@loggerjs/core";
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
  toEvent: recordToEvent,
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

  it("creates parent directories when mkdir is enabled", async () => {
    const path = join(dirname(tempFile()), "nested", "app.log");
    const transport = fileTransport({ path, mkdir: true, sync: true });

    transport.log?.(event, context);

    expect(readFileSync(path, "utf8")).toContain("fatal crash");
    await transport.close?.();
  });

  it("supports sync writes and append control", async () => {
    const path = tempFile();
    writeFileSync(path, "existing\n");
    const transport = fileTransport({ path, sync: true, append: false });

    transport.log?.(event, context);
    await transport.close?.();

    const content = readFileSync(path, "utf8");
    expect(content).toContain("fatal crash");
    expect(content).not.toContain("existing");
  });

  it("reports async stream errors through the transport context", async () => {
    const path = join(dirname(tempFile()), "missing", "app.log");
    const reportInternalError = vi.fn<TransportContext["reportInternalError"]>();
    const transport = fileTransport({ path });

    transport.log?.(event, { ...context, reportInternalError });

    await expect(transport.flush?.()).rejects.toMatchObject({ code: "ENOENT" });
    expect(reportInternalError).toHaveBeenCalledWith(expect.any(Error), {
      phase: "transport",
      transport: "file",
      operation: expect.stringMatching(/^(stream-error|write)$/),
    });
    await Promise.resolve(transport.close?.()).catch(() => undefined);
  });
});
