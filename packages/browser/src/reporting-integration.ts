import {
  normalizeValue,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export interface BrowserReportLike {
  type?: string;
  url?: string;
  body?: unknown;
  toJSON?: () => unknown;
}

export interface BrowserReportingObserverLike {
  observe: () => void;
  disconnect: () => void;
  takeRecords?: () => BrowserReportLike[];
}

export interface BrowserReportingObserverConstructor {
  new (
    callback: (reports: BrowserReportLike[], observer: BrowserReportingObserverLike) => void,
    options?: { buffered?: boolean; types?: readonly string[] },
  ): BrowserReportingObserverLike;
}

export interface BrowserReportPayload {
  type: string;
  url?: string;
  body?: unknown;
}

export interface BrowserCspViolationPayload {
  type: "securitypolicyviolation";
  blockedURI?: string;
  documentURI?: string;
  effectiveDirective?: string;
  violatedDirective?: string;
  disposition?: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  statusCode?: number;
  sample?: string;
}

export interface CaptureReportingOptions {
  captureSecurityPolicyViolation?: boolean;
  captureReportingObserver?: boolean;
  reportTypes?: readonly string[];
  level?:
    | LoggerLevel
    | ((report: BrowserReportPayload | BrowserCspViolationPayload) => LoggerLevel);
  buffered?: boolean;
  sanitizeUrl?: (url: string) => string;
  ReportingObserver?: BrowserReportingObserverConstructor;
  addEventListener?: typeof globalThis.addEventListener;
  removeEventListener?: typeof globalThis.removeEventListener;
}

const defaultReportTypes = ["csp-violation", "deprecation", "intervention", "crash"] as const;

function levelFor(
  level: CaptureReportingOptions["level"],
  report: BrowserReportPayload | BrowserCspViolationPayload,
): LoggerLevel {
  if (typeof level === "function") return level(report);
  if (level) return level;
  return report.type === "deprecation" ? "info" : "warn";
}

function maybeSanitize(
  url: string | undefined,
  sanitizeUrl: ((url: string) => string) | undefined,
) {
  return url && sanitizeUrl ? sanitizeUrl(url) : url;
}

function normalizeReport(
  report: BrowserReportLike,
  sanitizeUrl: ((url: string) => string) | undefined,
): BrowserReportPayload {
  const raw = typeof report.toJSON === "function" ? report.toJSON() : report;
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const body = "body" in record ? record.body : report.body;
  const url = typeof record.url === "string" ? record.url : report.url;
  const type = typeof record.type === "string" ? record.type : (report.type ?? "unknown");
  return {
    type,
    url: maybeSanitize(url, sanitizeUrl),
    body: normalizeValue(body, { maxDepth: 6, maxObjectKeys: 80 }),
  };
}

function normalizeCspViolation(
  event: SecurityPolicyViolationEvent,
  sanitizeUrl: ((url: string) => string) | undefined,
): BrowserCspViolationPayload {
  return {
    type: "securitypolicyviolation",
    blockedURI: maybeSanitize(event.blockedURI, sanitizeUrl),
    documentURI: maybeSanitize(event.documentURI, sanitizeUrl),
    effectiveDirective: event.effectiveDirective,
    violatedDirective: event.violatedDirective,
    disposition: event.disposition,
    sourceFile: maybeSanitize(event.sourceFile, sanitizeUrl),
    lineNumber: event.lineNumber,
    columnNumber: event.columnNumber,
    statusCode: event.statusCode,
    sample: event.sample,
  };
}

export function captureReportingIntegration(options: CaptureReportingOptions = {}): Integration {
  const captureSecurityPolicyViolation = options.captureSecurityPolicyViolation ?? true;
  const captureReportingObserver = options.captureReportingObserver ?? true;
  const reportTypes = options.reportTypes ?? defaultReportTypes;
  const buffered = options.buffered ?? true;

  return {
    name: "capture-reporting",
    setup(api: IntegrationSetupContext) {
      const add = options.addEventListener ?? globalThis.addEventListener?.bind(globalThis);
      const remove =
        options.removeEventListener ?? globalThis.removeEventListener?.bind(globalThis);
      const Observer =
        options.ReportingObserver ??
        (globalThis as unknown as { ReportingObserver?: BrowserReportingObserverConstructor })
          .ReportingObserver;
      const disposers: Array<() => void> = [];
      let disposed = false;

      const captureReport = api.guard((report: BrowserReportPayload) => {
        if (disposed) return;
        api.capture({
          level: levelFor(options.level, report),
          message: `Browser report ${report.type}`,
          props: { browser: { kind: "report", report } },
        });
      });

      if (captureSecurityPolicyViolation && add && remove) {
        const onViolation = api.guard((event: SecurityPolicyViolationEvent) => {
          const report = normalizeCspViolation(event, options.sanitizeUrl);
          api.capture({
            level: levelFor(options.level, report),
            message: `Security policy violation: ${report.effectiveDirective ?? report.violatedDirective ?? "unknown"}`,
            props: { browser: { kind: "securitypolicyviolation", report } },
          });
        });
        add("securitypolicyviolation", onViolation);
        disposers.push(() => remove("securitypolicyviolation", onViolation));
      }

      if (captureReportingObserver && Observer) {
        try {
          const observer = new Observer(
            (reports) => {
              for (const report of reports)
                captureReport(normalizeReport(report, options.sanitizeUrl));
            },
            { buffered, types: reportTypes },
          );
          observer.observe();
          disposers.push(() => {
            for (const report of observer.takeRecords?.() ?? [])
              captureReport(normalizeReport(report, options.sanitizeUrl));
            observer.disconnect();
          });
        } catch {
          // ReportingObserver is still uneven across browsers; failures should not break setup.
        }
      }

      return () => {
        if (disposed) return;
        for (const dispose of disposers) dispose();
        disposed = true;
      };
    },
  };
}
