import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { recordToEvent, type LogEvent, type TransportContext } from "@loggerjs/core";
import { rotatingFileTransport } from "../src";

const tempDirs: string[] = [];

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  toEvent: recordToEvent,
  reportInternalError() {},
};

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "loggerjs-rotating-file-"));
  tempDirs.push(dir);
  return join(dir, "app.log");
}

function event(message: string, patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: message,
    time: 1,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "test",
    message,
    ...patch,
  };
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("rotatingFileTransport", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rotates files by size and keeps newest archives first", async () => {
    const path = tempFile();
    const transport = rotatingFileTransport({ path, maxBytes: 1, maxFiles: 2 });

    transport.log?.(event("first"), context);
    transport.log?.(event("second"), context);
    transport.log?.(event("third"), context);
    await transport.close?.();

    expect(read(path)).toContain("third");
    expect(read(`${path}.1`)).toContain("second");
    expect(read(`${path}.2`)).toContain("first");
  });

  it("drops archives beyond maxFiles", async () => {
    const path = tempFile();
    const transport = rotatingFileTransport({ path, maxBytes: 1, maxFiles: 1 });

    transport.log?.(event("first"), context);
    transport.log?.(event("second"), context);
    transport.log?.(event("third"), context);
    await transport.close?.();

    expect(read(path)).toContain("third");
    expect(read(`${path}.1`)).toContain("second");
    expect(existsSync(`${path}.2`)).toBe(false);
  });

  it("supports logBatch and minLevel filtering", async () => {
    const path = tempFile();
    const transport = rotatingFileTransport({ path, maxBytes: 1_000_000, minLevel: "warn" });

    await transport.logBatch?.(
      [
        event("debug", { level: 20, levelName: "debug" }),
        event("warn", { level: 40, levelName: "warn" }),
        event("error", { level: 50, levelName: "error" }),
      ],
      context,
    );
    await transport.close?.();

    const content = read(path);
    expect(content).not.toContain("debug");
    expect(content).toContain("warn");
    expect(content).toContain("error");
  });

  it("creates parent directories through the shared destination", async () => {
    const path = join(dirname(tempFile()), "nested", "app.log");
    const transport = rotatingFileTransport({ path, mkdir: true });

    transport.log?.(event("created"), context);
    await transport.close?.();

    expect(read(path)).toContain("created");
  });

  describe("when rotation fails", () => {
    // Archiving into a directory that does not exist makes renameSync throw
    // ENOENT, standing in for EBUSY/EPERM from a file held open on Windows.
    function unwritableArchive(path: string): (base: string, index: number) => string {
      return (_base, index) => join(dirname(path), "missing", `app.log.${index}`);
    }

    function recordingContext(): TransportContext & { errors: Array<Record<string, unknown>> } {
      const errors: Array<Record<string, unknown>> = [];
      return {
        ...context,
        errors,
        reportInternalError(_error, detail) {
          errors.push(detail ?? {});
        },
      };
    }

    it("keeps writing to the current file and reports the failure", async () => {
      const path = tempFile();
      const failing = recordingContext();
      const transport = rotatingFileTransport({
        path,
        maxBytes: 1,
        maxFiles: 2,
        archivePath: unwritableArchive(path),
      });

      transport.log?.(event("first"), failing);
      transport.log?.(event("second"), failing);
      transport.log?.(event("third"), failing);
      await transport.close?.();

      const lines = read(path).trim().split("\n");
      expect(lines.map((line) => JSON.parse(line).message)).toEqual(["first", "second", "third"]);
      expect(failing.errors[0]).toMatchObject({
        phase: "transport",
        transport: "rotating-file",
        operation: "rotate",
      });
    });

    it("waits another maxBytes before retrying instead of failing on every write", async () => {
      const path = tempFile();
      const failing = recordingContext();
      const transport = rotatingFileTransport({
        path,
        maxBytes: 1_000,
        archivePath: unwritableArchive(path),
      });

      // Each line is about 100 bytes, so 60 lines cross maxBytes about five
      // times after the first failure rather than on every write.
      for (let index = 0; index < 60; index += 1) {
        transport.log?.(event(`message-${index}`), failing);
      }
      await transport.close?.();

      expect(read(path).trim().split("\n")).toHaveLength(60);
      expect(failing.errors.length).toBeGreaterThanOrEqual(2);
      expect(failing.errors.length).toBeLessThanOrEqual(6);
    });

    it("rotates again once the archive location becomes writable", async () => {
      const path = tempFile();
      const failing = recordingContext();
      const transport = rotatingFileTransport({
        path,
        maxBytes: 1,
        maxFiles: 1,
        archivePath: unwritableArchive(path),
      });

      transport.log?.(event("first"), failing);
      transport.log?.(event("second"), failing);
      mkdirSync(join(dirname(path), "missing"));
      transport.log?.(event("third"), failing);
      transport.log?.(event("fourth"), failing);
      await transport.close?.();

      expect(failing.errors).toHaveLength(1);
      expect(read(join(dirname(path), "missing", "app.log.1"))).toContain("third");
      expect(read(path)).toContain("fourth");
    });
  });
});
