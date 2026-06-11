import { describe, expect, it, vi } from "vitest";
import { recordToEvent, type LogEvent, type TransportContext } from "@loggerjs/core";
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
});
