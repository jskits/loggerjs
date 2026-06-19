import { safeJsonStringify, type LogEvent, type SafeStringifyOptions } from "@loggerjs/core";
import type { IndexedDbTransportQueryOptions } from "./indexeddb-transport";

export type LogZipExportFormat = "ndjson" | "json";

export interface ZipExportFile {
  name: string;
  content: string | Uint8Array | ArrayBuffer;
  lastModified?: number;
}

export interface LogZipBlobOptions {
  lastModified?: number;
  type?: string;
}

export interface LogZipExportQuerySource {
  query: (options?: IndexedDbTransportQueryOptions) => AsyncIterable<LogEvent>;
}

export type LogZipExportSource = AsyncIterable<LogEvent> | LogZipExportQuerySource;

export interface LogZipExportManifest {
  schema: "loggerjs.log-export.v1";
  createdAt: string;
  source?: string;
  format: LogZipExportFormat;
  logFileName: string;
  logCount: number;
  skippedCount: number;
  query?: IndexedDbTransportQueryOptions;
  timeRange?: {
    from: number;
    to: number;
  };
  recentLogFileName?: string;
  sessionCount?: number;
  sessions?: LogZipExportSessionManifest[];
}

export interface LogZipExportSessionManifest {
  sessionId: string;
  logFileName: string;
  logCount: number;
  timeRange?: {
    from: number;
    to: number;
  };
}

export interface LogZipExportSessionOptions {
  contextKey?: string;
  directory?: string;
  fallbackSessionId?: string;
  logFileName?: string;
}

export interface LogZipExportRecentOptions {
  logFileName?: string;
  maxEvents?: number;
}

export interface LogZipExportOptions {
  query?: IndexedDbTransportQueryOptions;
  format?: LogZipExportFormat;
  logFileName?: string;
  includeManifest?: boolean;
  manifestFileName?: string;
  source?: string;
  createdAt?: number;
  maxEvents?: number;
  stringify?: SafeStringifyOptions;
  serializeEvent?: (event: LogEvent) => string;
  mapEvent?: (event: LogEvent) => LogEvent | false | null | undefined;
  groupBySession?: boolean | LogZipExportSessionOptions;
  includeRecent?: boolean | LogZipExportRecentOptions;
}

export interface DownloadBlobOptions {
  filename?: string;
  document?: Document;
  url?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  revokeDelayMs?: number;
}

interface NormalizedZipFile {
  name: string;
  nameBytes: Uint8Array;
  contentBytes: Uint8Array;
  crc32: number;
  modifiedTime: number;
  modifiedDate: number;
  localHeaderOffset: number;
}

interface ExportedLogLine {
  event: LogEvent;
  line: string;
}

interface NormalizedSessionExportOptions {
  contextKey: string;
  directory: string;
  fallbackSessionId: string;
  logFileName: string;
}

interface NormalizedRecentExportOptions {
  logFileName: string;
  maxEvents: number;
}

const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_VERSION = 20;
const ZIP_MAX_UINT16 = 0xffff;
const ZIP_MAX_UINT32 = 0xffffffff;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const DEFAULT_SESSION_CONTEXT_KEY = "sessionId";

let crc32Table: Uint32Array | undefined;

function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  crc32Table = table;
  return table;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (table[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function normalizeFileContent(content: ZipExportFile["content"]): Uint8Array {
  if (typeof content === "string") return encodeText(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

function normalizeZipFileName(name: string): string {
  const normalized = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part.length > 0 && part !== "." && part !== "..")
    .join("/");
  if (!normalized) throw new Error("ZIP file name cannot be empty");
  return normalized;
}

function toDosDateTime(timestamp: number): { time: number; date: number } {
  const date = new Date(Number.isFinite(timestamp) ? timestamp : Date.now());
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function assertZipUint16(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > ZIP_MAX_UINT16) {
    throw new Error(`${label} exceeds ZIP32 limit`);
  }
}

function assertZipUint32(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > ZIP_MAX_UINT32) {
    throw new Error(`${label} exceeds ZIP32 limit`);
  }
}

function createLocalFileHeader(file: NormalizedZipFile): Uint8Array {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);
  view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_UTF8_FLAG, true);
  view.setUint16(8, ZIP_STORE_METHOD, true);
  view.setUint16(10, file.modifiedTime, true);
  view.setUint16(12, file.modifiedDate, true);
  view.setUint32(14, file.crc32, true);
  view.setUint32(18, file.contentBytes.byteLength, true);
  view.setUint32(22, file.contentBytes.byteLength, true);
  view.setUint16(26, file.nameBytes.byteLength, true);
  view.setUint16(28, 0, true);
  return header;
}

function createCentralDirectoryHeader(file: NormalizedZipFile): Uint8Array {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);
  view.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, ZIP_VERSION, true);
  view.setUint16(6, ZIP_VERSION, true);
  view.setUint16(8, ZIP_UTF8_FLAG, true);
  view.setUint16(10, ZIP_STORE_METHOD, true);
  view.setUint16(12, file.modifiedTime, true);
  view.setUint16(14, file.modifiedDate, true);
  view.setUint32(16, file.crc32, true);
  view.setUint32(20, file.contentBytes.byteLength, true);
  view.setUint32(24, file.contentBytes.byteLength, true);
  view.setUint16(28, file.nameBytes.byteLength, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, file.localHeaderOffset, true);
  return header;
}

function createEndOfCentralDirectory(
  fileCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
): Uint8Array {
  assertZipUint16(fileCount, "ZIP file count");
  assertZipUint32(centralDirectorySize, "ZIP central directory size");
  assertZipUint32(centralDirectoryOffset, "ZIP central directory offset");

  const footer = new Uint8Array(22);
  const view = new DataView(footer.buffer);
  view.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, fileCount, true);
  view.setUint16(10, fileCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);
  return footer;
}

function createNormalizedZipFiles(
  files: readonly ZipExportFile[],
  options: LogZipBlobOptions,
): NormalizedZipFile[] {
  const names = new Set<string>();
  let offset = 0;
  return files.map((file) => {
    const name = normalizeZipFileName(file.name);
    if (names.has(name)) throw new Error(`Duplicate ZIP file name: ${name}`);
    names.add(name);

    const nameBytes = encodeText(name);
    const contentBytes = normalizeFileContent(file.content);
    assertZipUint16(nameBytes.byteLength, `ZIP file name ${name}`);
    assertZipUint32(contentBytes.byteLength, `ZIP file ${name}`);
    assertZipUint32(offset, "ZIP local header offset");

    const modified = toDosDateTime(file.lastModified ?? options.lastModified ?? Date.now());
    const normalized: NormalizedZipFile = {
      name,
      nameBytes,
      contentBytes,
      crc32: crc32(contentBytes),
      modifiedTime: modified.time,
      modifiedDate: modified.date,
      localHeaderOffset: offset,
    };
    offset += 30 + nameBytes.byteLength + contentBytes.byteLength;
    assertZipUint32(offset, "ZIP local data size");
    return normalized;
  });
}

function isQuerySource(source: LogZipExportSource): source is LogZipExportQuerySource {
  return "query" in source && typeof source.query === "function";
}

function resolveSource(
  source: LogZipExportSource,
  query: IndexedDbTransportQueryOptions | undefined,
): AsyncIterable<LogEvent> {
  if (isQuerySource(source)) return source.query(query);
  if (query) throw new Error("Log ZIP export query options require a source with query()");
  return source;
}

function normalizeMaxEvents(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

function normalizeSessionExportOptions(
  value: boolean | LogZipExportSessionOptions | undefined,
  logFileName: string,
): NormalizedSessionExportOptions | undefined {
  if (!value) return undefined;
  const options = value === true ? {} : value;
  return {
    contextKey: options.contextKey ?? DEFAULT_SESSION_CONTEXT_KEY,
    directory: options.directory ?? "sessions",
    fallbackSessionId: options.fallbackSessionId ?? "unknown",
    logFileName: options.logFileName ?? logFileName,
  };
}

function normalizeRecentExportOptions(
  value: boolean | LogZipExportRecentOptions | undefined,
  format: LogZipExportFormat,
): NormalizedRecentExportOptions | undefined {
  if (!value) return undefined;
  const options = value === true ? {} : value;
  return {
    logFileName: options.logFileName ?? (format === "json" ? "recent.json" : "recent.ndjson"),
    maxEvents: normalizeMaxEvents(options.maxEvents) ?? 100,
  };
}

function logContentForLines(lines: readonly string[], format: LogZipExportFormat): string {
  if (format === "json") return `[${lines.join(",")}]`;
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function eventTimeRange(items: readonly ExportedLogLine[]):
  | {
      from: number;
      to: number;
    }
  | undefined {
  let from: number | undefined;
  let to: number | undefined;
  for (const item of items) {
    from = from === undefined ? item.event.time : Math.min(from, item.event.time);
    to = to === undefined ? item.event.time : Math.max(to, item.event.time);
  }
  return from === undefined || to === undefined ? undefined : { from, to };
}

function sessionIdForEvent(event: LogEvent, options: NormalizedSessionExportOptions): string {
  const value = event.context?.[options.contextKey];
  return typeof value === "string" && value.length > 0 ? value : options.fallbackSessionId;
}

function safeZipPathSegment(value: string): string {
  const encoded = encodeURIComponent(value).replace(/%/g, "_");
  if (!encoded || encoded === "." || encoded === "..") return "_";
  return encoded;
}

function sortByEventTime(items: readonly ExportedLogLine[]): ExportedLogLine[] {
  // oxlint-disable-next-line no-array-sort -- Sort a copy for stable export ordering.
  return [...items].sort((left, right) => {
    if (left.event.time !== right.event.time) return left.event.time - right.event.time;
    if (left.event.seq !== right.event.seq) return left.event.seq - right.event.seq;
    return left.event.id < right.event.id ? -1 : left.event.id > right.event.id ? 1 : 0;
  });
}

export function createLogZipBlob(
  files: readonly ZipExportFile[],
  options: LogZipBlobOptions = {},
): Blob {
  const normalizedFiles = createNormalizedZipFiles(files, options);
  const parts: Uint8Array[] = [];
  let centralDirectoryOffset = 0;
  for (const file of normalizedFiles) {
    parts.push(createLocalFileHeader(file), file.nameBytes, file.contentBytes);
    centralDirectoryOffset += 30 + file.nameBytes.byteLength + file.contentBytes.byteLength;
  }

  let centralDirectorySize = 0;
  for (const file of normalizedFiles) {
    const header = createCentralDirectoryHeader(file);
    parts.push(header, file.nameBytes);
    centralDirectorySize += header.byteLength + file.nameBytes.byteLength;
  }
  parts.push(
    createEndOfCentralDirectory(
      normalizedFiles.length,
      centralDirectorySize,
      centralDirectoryOffset,
    ),
  );

  return new Blob(parts as unknown as BlobPart[], { type: options.type ?? "application/zip" });
}

export async function exportLogsToZip(
  source: LogZipExportSource,
  options: LogZipExportOptions = {},
): Promise<Blob> {
  const format = options.format ?? "ndjson";
  const createdAt = options.createdAt ?? Date.now();
  const logFileName = options.logFileName ?? (format === "json" ? "logs.json" : "logs.ndjson");
  const maxEvents = normalizeMaxEvents(options.maxEvents);
  const sessionExportOptions = normalizeSessionExportOptions(options.groupBySession, logFileName);
  const recentExportOptions = normalizeRecentExportOptions(options.includeRecent, format);
  const serialize =
    options.serializeEvent ??
    ((event: LogEvent) => safeJsonStringify(event, options.stringify ?? {}));
  const exported: ExportedLogLine[] = [];
  let skippedCount = 0;

  for await (const event of resolveSource(source, options.query)) {
    if (maxEvents !== undefined && exported.length >= maxEvents) break;
    const mapped = options.mapEvent ? options.mapEvent(event) : event;
    if (!mapped) {
      skippedCount += 1;
      continue;
    }
    exported.push({ event: mapped, line: serialize(mapped) });
  }

  const files: ZipExportFile[] = [
    {
      name: logFileName,
      content: logContentForLines(
        exported.map((item) => item.line),
        format,
      ),
      lastModified: createdAt,
    },
  ];
  const sessionManifests: LogZipExportSessionManifest[] = [];

  if (sessionExportOptions) {
    const groups = new Map<string, ExportedLogLine[]>();
    for (const item of exported) {
      const sessionId = sessionIdForEvent(item.event, sessionExportOptions);
      const group = groups.get(sessionId) ?? [];
      group.push(item);
      groups.set(sessionId, group);
    }
    const usedFileNames = new Set(files.map((file) => normalizeZipFileName(file.name)));
    const sortedGroups = [...groups.entries()];
    sortedGroups.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    for (const [sessionId, group] of sortedGroups) {
      const sessionPath = `${sessionExportOptions.directory}/${safeZipPathSegment(sessionId)}/${
        sessionExportOptions.logFileName
      }`;
      let fileName = normalizeZipFileName(sessionPath);
      let suffix = 1;
      while (usedFileNames.has(fileName)) {
        fileName = normalizeZipFileName(
          `${sessionExportOptions.directory}/${safeZipPathSegment(sessionId)}-${suffix}/${
            sessionExportOptions.logFileName
          }`,
        );
        suffix += 1;
      }
      usedFileNames.add(fileName);
      const orderedGroup = sortByEventTime(group);
      files.push({
        name: fileName,
        content: logContentForLines(
          orderedGroup.map((item) => item.line),
          format,
        ),
        lastModified: createdAt,
      });
      sessionManifests.push({
        logCount: orderedGroup.length,
        logFileName: fileName,
        sessionId,
        timeRange: eventTimeRange(orderedGroup),
      });
    }
  }

  let recentLogFileName: string | undefined;
  if (recentExportOptions) {
    const recentItems =
      recentExportOptions.maxEvents <= 0
        ? []
        : sortByEventTime(exported).slice(-recentExportOptions.maxEvents);
    recentLogFileName = normalizeZipFileName(recentExportOptions.logFileName);
    files.push({
      name: recentLogFileName,
      content: logContentForLines(
        recentItems.map((item) => item.line),
        format,
      ),
      lastModified: createdAt,
    });
  }

  if (options.includeManifest ?? true) {
    const manifest: LogZipExportManifest = {
      schema: "loggerjs.log-export.v1",
      createdAt: new Date(createdAt).toISOString(),
      source: options.source,
      format,
      logFileName: normalizeZipFileName(logFileName),
      logCount: exported.length,
      skippedCount,
      query: options.query,
      recentLogFileName,
      sessionCount: sessionExportOptions ? sessionManifests.length : undefined,
      sessions: sessionExportOptions ? sessionManifests : undefined,
      timeRange: eventTimeRange(exported),
    };
    files.push({
      name: options.manifestFileName ?? "manifest.json",
      content: `${safeJsonStringify(manifest, { space: 2 })}\n`,
      lastModified: createdAt,
    });
  }

  return createLogZipBlob(files, { lastModified: createdAt });
}

export function downloadBlob(
  blob: Blob,
  filenameOrOptions: string | DownloadBlobOptions = {},
): string {
  const options =
    typeof filenameOrOptions === "string" ? { filename: filenameOrOptions } : filenameOrOptions;
  const documentRef = options.document ?? globalThis.document;
  const urlRef = options.url ?? globalThis.URL;
  if (!documentRef?.body || !urlRef?.createObjectURL || !urlRef.revokeObjectURL) {
    throw new Error("downloadBlob requires document and URL.createObjectURL");
  }

  const href = urlRef.createObjectURL(blob);
  const anchor = documentRef.createElement("a");
  anchor.href = href;
  anchor.download = options.filename ?? "loggerjs-logs.zip";
  anchor.style.display = "none";
  documentRef.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  const revoke = () => urlRef.revokeObjectURL(href);
  const revokeDelayMs = options.revokeDelayMs ?? 1000;
  if (revokeDelayMs <= 0) {
    revoke();
  } else {
    setTimeout(revoke, revokeDelayMs);
  }

  return href;
}
