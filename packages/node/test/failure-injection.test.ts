import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, getLoggerMetaStats, resetLoggerMetaStats } from "@loggerjs/core";
import { fileTransport } from "../src";

const nodeProcess = (
  globalThis as typeof globalThis & {
    process: { execPath: string };
  }
).process;
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../../..");
const rotatingWriter = join(testDir, "fixtures", "rotating-writer.ts");
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

function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((done) => {
    const poll = () => {
      if (condition() || Date.now() >= deadline) done();
      else setTimeout(poll, 20);
    };
    poll();
  });
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

  it("keeps rotated archives complete and ordered when the writer is killed", async () => {
    const path = join(tempDir(), "app.log");
    const child = spawn(nodeProcess.execPath, ["--import", "tsx", rotatingWriter, path], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    const exited = new Promise<void>((done) => child.once("exit", () => done()));

    // Kill without warning once a few rotations have happened.
    await waitUntil(() => existsSync(`${path}.3`), 15_000);
    child.kill("SIGKILL");
    await exited;
    expect(existsSync(`${path}.3`)).toBe(true);

    const files: string[] = [];
    for (let index = 200; index >= 1; index -= 1) {
      if (existsSync(`${path}.${index}`)) files.push(`${path}.${index}`);
    }
    if (existsSync(path)) files.push(path);

    const numbers: number[] = [];
    const archiveTails: Array<string | undefined> = [];
    for (const [fileIndex, file] of files.entries()) {
      const lines = readFileSync(file, "utf8").split("\n");
      const tail = lines.pop();
      // Archives were closed at a record boundary; only the file being
      // written at the kill may end in a partial line.
      if (fileIndex < files.length - 1) archiveTails.push(tail);
      for (const line of lines) {
        numbers.push((JSON.parse(line) as { data: { n: number } }).data.n);
      }
    }

    expect(archiveTails.length).toBeGreaterThanOrEqual(3);
    expect(archiveTails.every((tail) => tail === "")).toBe(true);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers).toEqual(numbers.map((_, index) => index));
  }, 30_000);
});
