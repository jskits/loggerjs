import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { symbolicateStackProcessor } from "../src/symbolicate-stack";

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
    message: "failed",
    stack: "    at minified (https://app.test/assets/app.js:10:5)",
  },
};

describe("symbolicateStackProcessor", () => {
  it("attaches original source frames returned by the symbolication hook", () => {
    const processed = symbolicateStackProcessor({
      symbolicate(frame) {
        if (frame.file !== "https://app.test/assets/app.js") return undefined;
        return {
          file: "src/App.tsx",
          line: 42,
          column: 7,
          function: "Checkout",
        };
      },
    })(event, context) as LogEvent;

    expect(processed.error?.symbolicatedFrames).toEqual([
      {
        raw: "at minified (https://app.test/assets/app.js:10:5)",
        file: "https://app.test/assets/app.js",
        line: 10,
        column: 5,
        function: "minified",
        original: {
          file: "src/App.tsx",
          line: 42,
          column: 7,
          function: "Checkout",
        },
      },
    ]);
  });

  it("can replace generated frames for display-oriented pipelines", () => {
    const processed = symbolicateStackProcessor({
      mode: "replace",
      symbolicate: () => ({ file: "src/App.tsx", line: 42, column: 7 }),
    })(event, context) as LogEvent;

    expect(processed.error?.symbolicatedFrames).toEqual([
      {
        raw: "at minified (https://app.test/assets/app.js:10:5)",
        file: "src/App.tsx",
        line: 42,
        column: 7,
      },
    ]);
  });
});
