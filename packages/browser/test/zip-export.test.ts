import { describe, expect, it, vi } from "vitest";
import type { LogEvent } from "@loggerjs/core";
import type { IndexedDbTransportQueryOptions } from "../src";
import { createLogZipBlob, downloadBlob, exportLogsToZip } from "../src";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

function event(id: string, time: number, patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id,
    time,
    seq: time,
    level: 30,
    levelName: "info",
    logger: "web",
    message: `message ${id}`,
    ...patch,
  };
}

async function* events(items: readonly LogEvent[]) {
  for (const item of items) yield item;
}

async function readZip(blob: Blob): Promise<Map<string, string>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const files = new Map<string, string>();
  let offset = 0;

  while (offset + 4 <= bytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature !== LOCAL_FILE_HEADER_SIGNATURE) break;

    const method = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    const contentStart = nameEnd + extraLength;
    const contentEnd = contentStart + size;

    expect(method).toBe(0);
    files.set(
      decoder.decode(bytes.slice(nameStart, nameEnd)),
      decoder.decode(bytes.slice(contentStart, contentEnd)),
    );
    offset = contentEnd;
  }

  expect(view.getUint32(bytes.byteLength - 22, true)).toBe(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  return files;
}

describe("zip export", () => {
  it("creates a stored zip blob with normalized file names", async () => {
    const zip = createLogZipBlob(
      [
        { name: "/logs\\client.ndjson", content: "one\n" },
        { name: "manifest.json", content: new TextEncoder().encode("{}") },
      ],
      { lastModified: 1_700_000_000_000 },
    );

    expect(zip.type).toBe("application/zip");
    const files = await readZip(zip);
    expect(files.get("logs/client.ndjson")).toBe("one\n");
    expect(files.get("manifest.json")).toBe("{}");
  });

  it("exports queryable logs as ndjson with a manifest", async () => {
    const source = {
      query: vi.fn<(options?: IndexedDbTransportQueryOptions) => AsyncIterable<LogEvent>>(() =>
        events([
          event("first", 1, { data: { token: "secret" } }),
          event("second", 2, { type: "ui.click" }),
        ]),
      ),
    };

    const zip = await exportLogsToZip(source, {
      query: { logger: "web", order: "asc" },
      source: "indexeddb",
      createdAt: 1_700_000_000_000,
      mapEvent(item) {
        return item.data ? { ...item, data: { token: "[redacted]" } } : item;
      },
    });

    expect(source.query).toHaveBeenCalledWith({ logger: "web", order: "asc" });
    const files = await readZip(zip);
    const lines = files
      .get("logs.ndjson")
      ?.trim()
      .split("\n")
      .map((line) => JSON.parse(line) as LogEvent);
    expect(lines?.map((item) => item.id)).toEqual(["first", "second"]);
    expect(lines?.[0]?.data).toEqual({ token: "[redacted]" });

    const manifest = JSON.parse(files.get("manifest.json") ?? "{}") as {
      source: string;
      logCount: number;
      timeRange: { from: number; to: number };
    };
    expect(manifest).toMatchObject({
      source: "indexeddb",
      logCount: 2,
      timeRange: { from: 1, to: 2 },
    });
  });

  it("exports session files and a recent file", async () => {
    const zip = await exportLogsToZip(
      events([
        event("first", 1, { context: { sessionId: "session-a" } }),
        event("second", 2, { context: { sessionId: "session-b" } }),
        event("third", 3, { context: { sessionId: "session-a" } }),
      ]),
      {
        createdAt: 1_700_000_000_000,
        groupBySession: true,
        includeRecent: { maxEvents: 2 },
        source: "indexeddb",
      },
    );

    const files = await readZip(zip);
    const sessionA = files
      .get("sessions/session-a/logs.ndjson")
      ?.trim()
      .split("\n")
      .map((line) => JSON.parse(line) as LogEvent);
    const sessionB = files
      .get("sessions/session-b/logs.ndjson")
      ?.trim()
      .split("\n")
      .map((line) => JSON.parse(line) as LogEvent);
    const recent = files
      .get("recent.ndjson")
      ?.trim()
      .split("\n")
      .map((line) => JSON.parse(line) as LogEvent);
    const manifest = JSON.parse(files.get("manifest.json") ?? "{}") as {
      recentLogFileName: string;
      sessionCount: number;
      sessions: Array<{ sessionId: string; logCount: number; logFileName: string }>;
    };

    expect(sessionA?.map((item) => item.id)).toEqual(["first", "third"]);
    expect(sessionB?.map((item) => item.id)).toEqual(["second"]);
    expect(recent?.map((item) => item.id)).toEqual(["second", "third"]);
    expect(manifest).toMatchObject({
      recentLogFileName: "recent.ndjson",
      sessionCount: 2,
      sessions: [
        {
          logCount: 2,
          logFileName: "sessions/session-a/logs.ndjson",
          sessionId: "session-a",
        },
        {
          logCount: 1,
          logFileName: "sessions/session-b/logs.ndjson",
          sessionId: "session-b",
        },
      ],
    });
  });

  it("exports raw async iterables as json without a manifest", async () => {
    const zip = await exportLogsToZip(events([event("first", 1), event("second", 2)]), {
      format: "json",
      includeManifest: false,
      logFileName: "export.json",
      maxEvents: 1,
    });

    const files = await readZip(zip);
    expect([...files.keys()]).toEqual(["export.json"]);
    expect(JSON.parse(files.get("export.json") ?? "[]")).toMatchObject([{ id: "first" }]);
  });

  it("downloads a blob through a temporary object URL", () => {
    const anchor = {
      href: "",
      download: "",
      style: { display: "" },
      click: vi.fn<() => void>(),
      remove: vi.fn<() => void>(),
    };
    const documentRef = {
      body: { appendChild: vi.fn<(node: unknown) => unknown>() },
      createElement: vi.fn<() => typeof anchor>(() => anchor),
    };
    const url = {
      createObjectURL: vi.fn<(blob: Blob | MediaSource) => string>(() => "blob:loggerjs"),
      revokeObjectURL: vi.fn<(url: string) => void>(),
    };

    expect(
      downloadBlob(new Blob(["zip"]), {
        document: documentRef as unknown as Document,
        filename: "logs.zip",
        revokeDelayMs: 0,
        url,
      }),
    ).toBe("blob:loggerjs");

    expect(anchor.download).toBe("logs.zip");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:loggerjs");
  });
});
