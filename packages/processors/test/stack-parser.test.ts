import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { parseStack, stackParserProcessor } from "../src/stack-parser";

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 1,
  reportInternalError() {},
};

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 50,
  levelName: "error",
  logger: "app",
  message: "failed",
  error: {
    name: "Error",
    message: "failed",
    stack: [
      "Error: failed",
      "    at loadCheckout (https://app.test/assets/app.js:10:5)",
      "    at node:internal/process/task_queues:95:5",
    ].join("\n"),
  },
};

describe("parseStack", () => {
  it("parses v8 stack frames", () => {
    expect(parseStack(event.error?.stack ?? "")[0]).toEqual({
      raw: "at loadCheckout (https://app.test/assets/app.js:10:5)",
      function: "loadCheckout",
      file: "https://app.test/assets/app.js",
      line: 10,
      column: 5,
    });
  });

  it("parses firefox and safari style stack frames", () => {
    expect(parseStack("loadCheckout@https://app.test/assets/app.js:12:7")[0]).toEqual({
      raw: "loadCheckout@https://app.test/assets/app.js:12:7",
      function: "loadCheckout",
      file: "https://app.test/assets/app.js",
      line: 12,
      column: 7,
    });
  });
});

describe("stackParserProcessor", () => {
  it("attaches parsed frames to the error by default", () => {
    const processed = stackParserProcessor({ dropInternal: true, includeRaw: false })(
      event,
      context,
    );

    expect(processed).toMatchObject({
      error: {
        frames: [
          {
            function: "loadCheckout",
            file: "https://app.test/assets/app.js",
            line: 10,
            column: 5,
          },
        ],
      },
    });
    expect((processed as LogEvent).error?.frames).not.toContainEqual(
      expect.objectContaining({ file: "node:internal/process/task_queues" }),
    );
  });

  it("supports custom parser, key, max frames, and context target", () => {
    const processed = stackParserProcessor({
      parser: () => [
        { raw: "one", file: "one.ts", line: 1 },
        { raw: "two", file: "two.ts", line: 2 },
      ],
      maxFrames: 1,
      target: "context",
      key: "parsedStack",
    })(event, context);

    expect(processed).toMatchObject({
      context: {
        parsedStack: [{ raw: "one", file: "one.ts", line: 1 }],
      },
    });
  });
});
