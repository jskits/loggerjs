import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, getLoggerMetaStats, resetLoggerMetaStats } from "@loggerjs/core";
import { fileTransport } from "../src";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "loggerjs-failure-"));
  tempDirs.push(dir);
  return dir;
}

async function settlesWithin<T>(promise: Promise<T> | T, ms = 2_000): Promise<"settled"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((done) => {
    timer = setTimeout(() => done("timeout"), ms);
  });
  const settled = Promise.resolve(promise).then(
    () => "settled" as const,
    () => "settled" as const,
  );
  const result = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  if (result === "timeout") throw new Error(`did not settle within ${ms}ms`);
  return result;
}

interface UnwritableTarget {
  name: string;
  path: () => string;
}

// Real filesystem failures rather than mocked streams: a directory fails every
// write with EISDIR everywhere, and /dev/full fails with ENOSPC on Linux.
const unwritableTargets: UnwritableTarget[] = [
  {
    name: "a directory (EISDIR)",
    path: () => {
      const dir = join(tempDir(), "is-a-directory");
      mkdirSync(dir);
      return dir;
    },
  },
  ...(existsSync("/dev/full") ? [{ name: "a full disk (ENOSPC)", path: () => "/dev/full" }] : []),
];

describe("file transports under injected failures", () => {
  afterEach(() => {
    resetLoggerMetaStats();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  describe.each(unwritableTargets)("writing to $name", (target) => {
    it.each([false, true])(
      "keeps the app running and settles flush and close (sync: %s)",
      async (sync) => {
        const errors: unknown[] = [];
        const logger = createLogger({
          transports: [fileTransport({ path: target.path(), sync })],
          onInternalError: (error) => errors.push(error),
        });

        expect(() => {
          logger.info("first");
          logger.error("second");
        }).not.toThrow();
        await settlesWithin(logger.flush());
        logger.info("after the failure");
        await settlesWithin(logger.flush());
        await settlesWithin(logger.close());

        expect(errors.length).toBeGreaterThan(0);
        expect(getLoggerMetaStats()["transport.errors"]).toBeGreaterThan(0);
      },
    );
  });
});
