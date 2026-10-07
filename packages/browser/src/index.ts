export * from "@loggerjs/core";
export {
  /** @deprecated Import from "@loggerjs/browser/transport-broadcast-channel"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserBroadcastChannelBatchMessage,
  /** @deprecated Import from "@loggerjs/browser/transport-broadcast-channel"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserBroadcastChannelErrorDetail,
  /** @deprecated Import from "@loggerjs/browser/transport-broadcast-channel"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserBroadcastChannelEventMessage,
  /** @deprecated Import from "@loggerjs/browser/transport-broadcast-channel"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserBroadcastChannelFactory,
  /** @deprecated Import from "@loggerjs/browser/transport-broadcast-channel"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserBroadcastChannelLike,
  /** @deprecated Import from "@loggerjs/browser/transport-broadcast-channel"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserBroadcastChannelMapContext,
  /** @deprecated Import from "@loggerjs/browser/transport-broadcast-channel"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserBroadcastChannelMessage,
  /** @deprecated Import from "@loggerjs/browser/transport-broadcast-channel"; the @loggerjs/browser root export is removed in 1.0. */
  browserBroadcastChannelTransport,
  /** @deprecated Import from "@loggerjs/browser/transport-broadcast-channel"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserBroadcastChannelTransportOptions,
} from "./broadcast-channel-transport";
export * from "./http-transport";
export {
  /** @deprecated Import from "@loggerjs/browser/payload-transforms"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserCompressionFormat,
  /** @deprecated Import from "@loggerjs/browser/payload-transforms"; the @loggerjs/browser root export is removed in 1.0. */
  browserCompressionPayloadTransform,
  /** @deprecated Import from "@loggerjs/browser/payload-transforms"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserCompressionPayloadTransformOptions,
} from "./payload-transforms";
export {
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerBatchMessage,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerContainerLike,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerDropPolicy,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerEventMessage,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerLike,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerMapContext,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerMessage,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerRegistrationLike,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerTarget,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  browserServiceWorkerTransport,
  /** @deprecated Import from "@loggerjs/browser/transport-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerTransportOptions,
} from "./service-worker-transport";
export {
  /** @deprecated Import from "@loggerjs/browser/transport-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketDropPolicy,
  /** @deprecated Import from "@loggerjs/browser/transport-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketErrorDetail,
  /** @deprecated Import from "@loggerjs/browser/transport-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketEventType,
  /** @deprecated Import from "@loggerjs/browser/transport-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketFactory,
  /** @deprecated Import from "@loggerjs/browser/transport-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketLike,
  /** @deprecated Import from "@loggerjs/browser/transport-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketPayload,
  /** @deprecated Import from "@loggerjs/browser/transport-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  browserWebSocketTransport,
  /** @deprecated Import from "@loggerjs/browser/transport-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketTransport,
  /** @deprecated Import from "@loggerjs/browser/transport-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketTransportOptions,
} from "./websocket-transport";
export * from "./indexeddb-offline-queue";
export * from "./indexeddb-transport";
export * from "./offline-first-transport";
export {
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  createLogZipBlob,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  downloadBlob,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type DownloadBlobOptions,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  exportLogsToZip,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type LogZipBlobOptions,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type LogZipExportFormat,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type LogZipExportManifest,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type LogZipExportOptions,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type LogZipExportQuerySource,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type LogZipExportRecentOptions,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type LogZipExportSessionManifest,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type LogZipExportSessionOptions,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type LogZipExportSource,
  /** @deprecated Import from "@loggerjs/browser/export-zip"; the @loggerjs/browser root export is removed in 1.0. */
  type ZipExportFile,
} from "./zip-export";
export * from "./console-integration";
export * from "./context-propagation-integration";
export * from "./error-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-fetch"; the @loggerjs/browser root export is removed in 1.0. */
  captureFetchIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-fetch"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureFetchOptions,
} from "./fetch-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-xhr"; the @loggerjs/browser root export is removed in 1.0. */
  captureXHRIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-xhr"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureXHROptions,
} from "./xhr-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-framework-errors"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserFrameworkErrorInfo,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-errors"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserFrameworkErrorIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-errors"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserFrameworkName,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-errors"; the @loggerjs/browser root export is removed in 1.0. */
  captureFrameworkErrorsIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-errors"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureFrameworkErrorsOptions,
} from "./framework-error-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  type FrameworkRouterIntegrationOptions,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  nextRouterIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  type NextRouterIntegrationOptions,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  type NextRouterLike,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  nuxtRouterIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  type ReactRouterHistoryLike,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  reactRouterIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  type ReactRouterIntegrationOptions,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  vueRouterIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  type VueRouterIntegrationOptions,
  /** @deprecated Import from "@loggerjs/browser/integration-framework-routers"; the @loggerjs/browser root export is removed in 1.0. */
  type VueRouterLike,
} from "./framework-router-integrations";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-reporting"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserCspViolationPayload,
  /** @deprecated Import from "@loggerjs/browser/integration-reporting"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserReportingObserverConstructor,
  /** @deprecated Import from "@loggerjs/browser/integration-reporting"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserReportingObserverLike,
  /** @deprecated Import from "@loggerjs/browser/integration-reporting"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserReportLike,
  /** @deprecated Import from "@loggerjs/browser/integration-reporting"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserReportPayload,
  /** @deprecated Import from "@loggerjs/browser/integration-reporting"; the @loggerjs/browser root export is removed in 1.0. */
  captureReportingIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-reporting"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureReportingOptions,
} from "./reporting-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-router"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserHistoryLike,
  /** @deprecated Import from "@loggerjs/browser/integration-router"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserLocationLike,
  /** @deprecated Import from "@loggerjs/browser/integration-router"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserRouteChangePayload,
  /** @deprecated Import from "@loggerjs/browser/integration-router"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserRouteTrigger,
  /** @deprecated Import from "@loggerjs/browser/integration-router"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserRouteUrlMode,
  /** @deprecated Import from "@loggerjs/browser/integration-router"; the @loggerjs/browser root export is removed in 1.0. */
  captureRouterIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-router"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureRouterOptions,
} from "./router-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-runtime-host"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserExtensionEventLike,
  /** @deprecated Import from "@loggerjs/browser/integration-runtime-host"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserExtensionMessageSenderLike,
  /** @deprecated Import from "@loggerjs/browser/integration-runtime-host"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserExtensionRuntimeLike,
  /** @deprecated Import from "@loggerjs/browser/integration-runtime-host"; the @loggerjs/browser root export is removed in 1.0. */
  captureRuntimeHostIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-runtime-host"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureRuntimeHostOptions,
  /** @deprecated Import from "@loggerjs/browser/integration-runtime-host"; the @loggerjs/browser root export is removed in 1.0. */
  type ElectronIpcRendererLike,
} from "./runtime-host-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerContainerEventsLike,
  /** @deprecated Import from "@loggerjs/browser/integration-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerControllerLike,
  /** @deprecated Import from "@loggerjs/browser/integration-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserServiceWorkerMessagePayload,
  /** @deprecated Import from "@loggerjs/browser/integration-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  captureServiceWorkerIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-service-worker"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureServiceWorkerOptions,
} from "./service-worker-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-user-actions"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserEventTargetLike,
  /** @deprecated Import from "@loggerjs/browser/integration-user-actions"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserUserActionEventName,
  /** @deprecated Import from "@loggerjs/browser/integration-user-actions"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserUserActionPayload,
  /** @deprecated Import from "@loggerjs/browser/integration-user-actions"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserUserActionTarget,
  /** @deprecated Import from "@loggerjs/browser/integration-user-actions"; the @loggerjs/browser root export is removed in 1.0. */
  captureUserActionsIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-user-actions"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureUserActionsOptions,
} from "./user-action-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserCapturedWebSocketConstructor,
  /** @deprecated Import from "@loggerjs/browser/integration-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserCapturedWebSocketLike,
  /** @deprecated Import from "@loggerjs/browser/integration-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketDirection,
  /** @deprecated Import from "@loggerjs/browser/integration-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserWebSocketMessagePayload,
  /** @deprecated Import from "@loggerjs/browser/integration-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  captureWebSocketIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-websocket"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureWebSocketOptions,
} from "./websocket-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-web-vitals"; the @loggerjs/browser root export is removed in 1.0. */
  captureWebVitalsIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-web-vitals"; the @loggerjs/browser root export is removed in 1.0. */
  type CaptureWebVitalsOptions,
  /** @deprecated Import from "@loggerjs/browser/integration-web-vitals"; the @loggerjs/browser root export is removed in 1.0. */
  type WebVitalMetric,
  /** @deprecated Import from "@loggerjs/browser/integration-web-vitals"; the @loggerjs/browser root export is removed in 1.0. */
  type WebVitalName,
  /** @deprecated Import from "@loggerjs/browser/integration-web-vitals"; the @loggerjs/browser root export is removed in 1.0. */
  type WebVitalRating,
} from "./web-vitals-integration";
export {
  /** @deprecated Import from "@loggerjs/browser/integration-performance"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserPerformanceEntryPayload,
  /** @deprecated Import from "@loggerjs/browser/integration-performance"; the @loggerjs/browser root export is removed in 1.0. */
  type BrowserPerformanceEntryType,
  /** @deprecated Import from "@loggerjs/browser/integration-performance"; the @loggerjs/browser root export is removed in 1.0. */
  capturePerformanceIntegration,
  /** @deprecated Import from "@loggerjs/browser/integration-performance"; the @loggerjs/browser root export is removed in 1.0. */
  type CapturePerformanceOptions,
  /** @deprecated Import from "@loggerjs/browser/integration-performance"; the @loggerjs/browser root export is removed in 1.0. */
  normalizeBrowserPerformanceEntry,
} from "./performance-integration";
export * from "./page-lifecycle";
