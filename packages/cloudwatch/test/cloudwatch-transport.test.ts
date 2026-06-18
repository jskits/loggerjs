import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordToEvent,
  retryTransport,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
import {
  type AwsV4SignRequestOptions,
  cloudWatchLogsTransport,
  createCloudWatchPutLogEventsRequest,
  signAwsV4Request,
  toCloudWatchLogEvent,
} from "../src";

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  toEvent: recordToEvent,
  reportInternalError() {},
};

function event(message: string, patch: Partial<LogEvent> = {}): LogEvent {
  return {
    id: message,
    time: 2,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "api",
    message,
    data: { ok: true },
    ...patch,
  };
}

function requestJson(fetchFn: ReturnType<typeof vi.fn<typeof fetch>>) {
  const init = fetchFn.mock.calls[0]?.[1];
  if (!init?.body || typeof init.body !== "string") throw new Error("Missing JSON body");
  return JSON.parse(init.body) as unknown;
}

describe("cloudWatchLogsTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates sorted PutLogEvents requests by stream", () => {
    const requests = createCloudWatchPutLogEventsRequest(
      [
        event("late", { time: 3 }),
        event("early", { time: 1 }),
        event("other", { logger: "worker", time: 2 }),
      ],
      {
        logGroupName: "group",
        logStreamName: (item) => item.logger,
        message: (item) => item.message,
      },
    );

    expect(requests).toEqual([
      {
        logEvents: [
          { message: "early", timestamp: 1 },
          { message: "late", timestamp: 3 },
        ],
        logGroupName: "group",
        logStreamName: "api",
      },
      {
        logEvents: [{ message: "other", timestamp: 2 }],
        logGroupName: "group",
        logStreamName: "worker",
      },
    ]);
  });

  it("converts log events to structured CloudWatch messages by default", () => {
    expect(JSON.parse(toCloudWatchLogEvent(event("created")).message)).toMatchObject({
      data: { ok: true },
      level: "info",
      logger: "api",
      message: "created",
    });
  });

  it("sends signed PutLogEvents requests", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const signer = vi.fn<(request: AwsV4SignRequestOptions) => Promise<Record<string, string>>>(
      async (request) => ({
        ...request.headers,
        authorization: "signed",
      }),
    );
    const transport = cloudWatchLogsTransport({
      credentials: {
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
      },
      fetchFn,
      logGroupName: "group",
      logStreamName: "stream",
      message: (item) => item.message,
      region: "us-east-1",
      signer,
    });

    await transport.log?.(event("created"), context);

    expect(signer).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        region: "us-east-1",
        service: "logs",
        url: "https://logs.us-east-1.amazonaws.com/",
      }),
    );
    expect(fetchFn).toHaveBeenCalledWith(
      "https://logs.us-east-1.amazonaws.com/",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "signed",
          "x-amz-target": "Logs_20140328.PutLogEvents",
        }),
        method: "POST",
      }),
    );
    expect(requestJson(fetchFn)).toEqual({
      logEvents: [{ message: "created", timestamp: 2 }],
      logGroupName: "group",
      logStreamName: "stream",
    });
  });

  it("filters batches by minLevel", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const transport = cloudWatchLogsTransport({
      credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
      fetchFn,
      logGroupName: "group",
      logStreamName: "stream",
      message: (item) => item.message,
      minLevel: "warn",
      region: "us-east-1",
      signer: async (request) => request.headers,
    });

    await transport.logBatch?.(
      [
        event("debug", { level: 20, levelName: "debug" }),
        event("warn", { level: 40, levelName: "warn" }),
      ],
      context,
    );

    expect(requestJson(fetchFn)).toMatchObject({
      logEvents: [{ message: "warn", timestamp: 2 }],
    });
  });

  it("generates deterministic SigV4 headers", async () => {
    const headers = await signAwsV4Request({
      body: "{}",
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": "Logs_20140328.PutLogEvents",
      },
      method: "POST",
      now: new Date("2015-08-30T12:36:00Z"),
      region: "us-east-1",
      service: "logs",
      url: "https://logs.us-east-1.amazonaws.com/",
    });

    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers.authorization).toContain(
      "Credential=AKIDEXAMPLE/20150830/us-east-1/logs/aws4_request",
    );
    expect(headers.authorization).toContain(
      "SignedHeaders=content-type;host;x-amz-date;x-amz-target",
    );
  });

  it("matches the AWS SigV4 known-answer signature", async () => {
    const headers = await signAwsV4Request({
      body: "",
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      },
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      method: "GET",
      now: new Date("2015-08-30T12:36:00Z"),
      region: "us-east-1",
      service: "iam",
      url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
    });

    expect(headers).toMatchObject({
      host: "iam.amazonaws.com",
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      "x-amz-date": "20150830T123600Z",
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });

  it("does not send when minLevel filters a single event or an entire batch", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const signer = vi.fn<(request: AwsV4SignRequestOptions) => Record<string, string>>(
      (request) => request.headers,
    );
    const transport = cloudWatchLogsTransport({
      credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
      fetchFn,
      logGroupName: "group",
      logStreamName: "stream",
      minLevel: "error",
      region: "us-east-1",
      signer,
    });

    await transport.log?.(event("debug", { level: 20, levelName: "debug" }), context);
    await transport.logBatch?.(
      [
        event("info", { level: 30, levelName: "info" }),
        event("warn", { level: 40, levelName: "warn" }),
      ],
      context,
    );

    expect(signer).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws a transport-specific error on non-2xx responses without dropping signed headers", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("nope", { status: 500 }));
    const transport = cloudWatchLogsTransport({
      credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
      endpoint: "https://logs.example.test/",
      fetchFn,
      headers: { "x-custom": "present" },
      logGroupName: "group",
      logStreamName: "stream",
      region: "us-east-1",
      signer: async (request) => ({ ...request.headers, authorization: "signed" }),
    });

    await expect(transport.log?.(event("failed"), context)).rejects.toThrow(
      "cloudWatchLogsTransport failed with status 500",
    );
    expect(fetchFn.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "signed",
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "Logs_20140328.PutLogEvents",
      "x-custom": "present",
    });
  });

  it("propagates fetch rejections", async () => {
    const error = new TypeError("network down");
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw error;
    });
    const transport = cloudWatchLogsTransport({
      credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
      fetchFn,
      logGroupName: "group",
      logStreamName: "stream",
      region: "us-east-1",
      signer: async (request) => request.headers,
    });

    await expect(transport.log?.(event("failed"), context)).rejects.toBe(error);
  });

  it("fails explicitly when fetch is unavailable", async () => {
    vi.stubGlobal("fetch", undefined);
    const transport = cloudWatchLogsTransport({
      credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
      logGroupName: "group",
      logStreamName: "stream",
      region: "us-east-1",
      signer: async (request) => request.headers,
    });

    await expect(transport.log?.(event("failed"), context)).rejects.toThrow(
      "fetch is not available for cloudWatchLogsTransport",
    );
  });

  it("can be wrapped with retryTransport for transient delivery failures", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (fetchFn.mock.calls.length === 1) return new Response("temporary", { status: 503 });
      return new Response("{}", { status: 200 });
    });
    const transport = retryTransport(
      cloudWatchLogsTransport({
        credentials: { accessKeyId: "AKID", secretAccessKey: "SECRET" },
        fetchFn,
        logGroupName: "group",
        logStreamName: "stream",
        message: (item) => item.message,
        region: "us-east-1",
        signer: async (request) => request.headers,
      }),
      {
        maxRetries: 1,
        retryBaseDelayMs: 0,
        retryMaxDelayMs: 0,
      },
    );

    await transport.log?.(event("retried"), context);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(requestJson(fetchFn)).toMatchObject({
      logEvents: [{ message: "retried", timestamp: 2 }],
    });
  });
});
