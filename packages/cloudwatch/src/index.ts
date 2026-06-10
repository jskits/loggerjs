import {
  safeJsonStringify,
  toLevelValue,
  type LogEvent,
  type LoggerLevel,
  type Transport,
} from "@loggerjs/core";

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export type AwsCredentialsProvider = () => AwsCredentials | Promise<AwsCredentials>;

export interface AwsV4SignRequestOptions {
  method: string;
  url: string;
  region: string;
  service: string;
  headers: Record<string, string>;
  body: string;
  credentials: AwsCredentials;
  now?: Date;
}

export interface CloudWatchLogEvent {
  timestamp: number;
  message: string;
}

export interface CloudWatchPutLogEventsRequest {
  logGroupName: string;
  logStreamName: string;
  logEvents: CloudWatchLogEvent[];
}

export interface CloudWatchLogsTransportOptions {
  region: string;
  logGroupName: string;
  logStreamName: string | ((event: LogEvent) => string);
  name?: string;
  minLevel?: LoggerLevel;
  endpoint?: string;
  headers?: Record<string, string>;
  credentials?: AwsCredentials | AwsCredentialsProvider;
  signer?: (
    request: AwsV4SignRequestOptions,
  ) => Record<string, string> | Promise<Record<string, string>>;
  message?: (event: LogEvent) => string;
  now?: () => Date;
  fetchFn?: typeof fetch;
}

const encoder = new TextEncoder();

function bytes(value: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return typeof value === "string"
    ? Uint8Array.from(encoder.encode(value))
    : Uint8Array.from(value);
}

function hex(data: Uint8Array): string {
  let out = "";
  for (const byte of data) out += byte.toString(16).padStart(2, "0");
  return out;
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required for AWS SigV4 signing");
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes(value))));
}

async function hmac(key: string | Uint8Array, value: string): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is required for AWS SigV4 signing");
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    bytes(key),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, bytes(value)));
}

function amzDate(date: Date): { dateStamp: string; timestamp: string } {
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { dateStamp: timestamp.slice(0, 8), timestamp };
}

function normalizeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value.trim().replace(/\s+/g, " ");
  }
  return out;
}

function sortedCopy<T>(items: readonly T[], compare: (left: T, right: T) => number): T[] {
  const out = [...items];
  // oxlint-disable-next-line no-array-sort -- Sorting a copy keeps the input immutable on ES2020.
  out.sort(compare);
  return out;
}

function canonicalQuery(url: URL): string {
  return sortedCopy([...url.searchParams.entries()], ([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export async function signAwsV4Request(
  options: AwsV4SignRequestOptions,
): Promise<Record<string, string>> {
  const url = new URL(options.url);
  const { dateStamp, timestamp } = amzDate(options.now ?? new Date());
  const headers = normalizeHeaders({
    ...options.headers,
    host: url.host,
    "x-amz-date": timestamp,
  });
  if (options.credentials.sessionToken) {
    headers["x-amz-security-token"] = options.credentials.sessionToken;
  }

  const signedHeaders = sortedCopy(Object.keys(headers), (a, b) => a.localeCompare(b));
  const canonicalHeaders = signedHeaders.map((key) => `${key}:${headers[key]}\n`).join("");
  const payloadHash = await sha256Hex(options.body);
  const canonicalRequest = [
    options.method.toUpperCase(),
    url.pathname || "/",
    canonicalQuery(url),
    canonicalHeaders,
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = await hmac(`AWS4${options.credentials.secretAccessKey}`, dateStamp);
  const regionKey = await hmac(dateKey, options.region);
  const serviceKey = await hmac(regionKey, options.service);
  const signingKey = await hmac(serviceKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${options.credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
  };
}

function defaultEndpoint(region: string): string {
  return `https://logs.${region}.amazonaws.com/`;
}

function streamName(event: LogEvent, value: CloudWatchLogsTransportOptions["logStreamName"]) {
  return typeof value === "function" ? value(event) : value;
}

function defaultMessage(event: LogEvent): string {
  return safeJsonStringify({
    message: event.message,
    logger: event.logger,
    level: event.levelName,
    type: event.type,
    tags: event.tags,
    data: event.data,
    error: event.error,
    context: event.context,
    trace: event.trace,
    id: event.id,
    seq: event.seq,
  });
}

export function toCloudWatchLogEvent(
  event: LogEvent,
  message: (event: LogEvent) => string = defaultMessage,
): CloudWatchLogEvent {
  return {
    timestamp: Math.trunc(event.time),
    message: message(event),
  };
}

export function createCloudWatchPutLogEventsRequest(
  events: readonly LogEvent[],
  options: Pick<CloudWatchLogsTransportOptions, "logGroupName" | "logStreamName" | "message">,
): CloudWatchPutLogEventsRequest[] {
  const groups = new Map<string, CloudWatchLogEvent[]>();
  for (const event of events) {
    const name = streamName(event, options.logStreamName);
    const group = groups.get(name) ?? [];
    group.push(toCloudWatchLogEvent(event, options.message));
    groups.set(name, group);
  }

  const requests: CloudWatchPutLogEventsRequest[] = [];
  for (const [logStreamName, logEvents] of groups) {
    const sortedLogEvents = sortedCopy(logEvents, (a, b) => a.timestamp - b.timestamp);
    for (let index = 0; index < sortedLogEvents.length; index += 10_000) {
      requests.push({
        logGroupName: options.logGroupName,
        logStreamName,
        logEvents: sortedLogEvents.slice(index, index + 10_000),
      });
    }
  }
  return requests;
}

async function credentialsFor(
  credentials: AwsCredentials | AwsCredentialsProvider | undefined,
): Promise<AwsCredentials> {
  const value = typeof credentials === "function" ? await credentials() : credentials;
  if (!value) throw new Error("AWS credentials are required for cloudWatchLogsTransport");
  return value;
}

export function cloudWatchLogsTransport(options: CloudWatchLogsTransportOptions): Transport {
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  const transportName = options.name ?? "cloudwatch-logs";
  const endpoint = options.endpoint ?? defaultEndpoint(options.region);

  const send = async (events: LogEvent[]) => {
    if (events.length === 0) return;
    if (!fetchFn) throw new Error("fetch is not available for cloudWatchLogsTransport");
    const requests = createCloudWatchPutLogEventsRequest(events, options);
    const credentials = await credentialsFor(options.credentials);
    await Promise.all(
      requests.map(async (request) => {
        const body = JSON.stringify(request);
        const headers: Record<string, string> = {
          "content-type": "application/x-amz-json-1.1",
          "x-amz-target": "Logs_20140328.PutLogEvents",
          ...options.headers,
        };
        const signedHeaders = options.signer
          ? await options.signer({
              body,
              credentials,
              headers,
              method: "POST",
              now: options.now?.(),
              region: options.region,
              service: "logs",
              url: endpoint,
            })
          : await signAwsV4Request({
              body,
              credentials,
              headers,
              method: "POST",
              now: options.now?.(),
              region: options.region,
              service: "logs",
              url: endpoint,
            });
        const response = await fetchFn(endpoint, {
          body,
          headers: signedHeaders,
          method: "POST",
        });
        if (!response.ok) {
          throw new Error(`cloudWatchLogsTransport failed with status ${response.status}`);
        }
      }),
    );
  };

  return {
    name: transportName,
    minLevel: options.minLevel,
    log(event) {
      if (options.minLevel !== undefined && event.level < toLevelValue(options.minLevel)) return;
      return send([event]);
    },
    logBatch(events) {
      const selected =
        options.minLevel === undefined
          ? events
          : events.filter((event) => event.level >= toLevelValue(options.minLevel));
      return send([...selected]);
    },
  };
}
