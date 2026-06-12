import { afterEach, describe, expect, it } from "vitest";
import {
  addContextProvider,
  formatBaggage,
  formatTraceparent,
  getContext,
  parseBaggage,
  parseTraceparent,
  resetContextManager,
  setContextProvider,
  traceContextFromHeaders,
  traceContextToHeaders,
} from "../src";

describe("trace propagation", () => {
  afterEach(() => {
    setContextProvider(undefined);
    resetContextManager();
  });

  it("parses and formats W3C traceparent values", () => {
    const trace = parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");

    expect(trace).toEqual({
      sampled: true,
      spanId: "00f067aa0ba902b7",
      traceFlags: "01",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
    expect(formatTraceparent(trace)).toBe(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
    expect(parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01")).toBe(
      undefined,
    );
  });

  it("parses and formats baggage headers", () => {
    expect(parseBaggage("tenant=acme,user=dev%201;meta=value")).toEqual({
      tenant: "acme",
      user: "dev 1",
    });
    expect(formatBaggage({ tenant: "acme", user: "dev 1" })).toBe("tenant=acme,user=dev%201");
  });

  it("maps trace context to and from headers", () => {
    const trace = traceContextFromHeaders({
      baggage: "tenant=acme",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
    });

    expect(trace).toMatchObject({
      baggage: { tenant: "acme" },
      sampled: false,
    });
    expect(traceContextToHeaders(trace)).toEqual({
      baggage: "tenant=acme",
      traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00",
    });
  });

  it("composes ambient context providers and restores the previous provider", () => {
    setContextProvider(() => ({ app: "checkout" }));
    const dispose = addContextProvider(() => ({ sessionId: "s1" }));

    expect(getContext()).toEqual({ app: "checkout", sessionId: "s1" });

    dispose();
    expect(getContext()).toEqual({ app: "checkout" });
  });
});
