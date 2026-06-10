import {
  browserHttpTransport,
  captureBrowserErrorsIntegration,
  captureConsoleIntegration,
  captureFetchIntegration,
  createLogger,
  pageLifecycleIntegration,
} from "@loggerjs/browser";
import { redactProcessor, sampleProcessor } from "@loggerjs/processors";

const logger = createLogger({
  name: "web",
  level: "debug",
  tags: { app: "demo", env: "local" },
  processors: [
    redactProcessor(),
    sampleProcessor({ rates: { debug: 0.2, info: 1, warn: 1, error: 1, fatal: 1, trace: 0.05 } }),
  ],
  transports: [
    browserHttpTransport({
      url: "/api/logs",
      maxBatchSize: 20,
      flushIntervalMs: 1500,
      useBeaconOnPageHide: true,
    }),
  ],
  integrations: [
    captureConsoleIntegration({ levels: ["warn", "error"] }),
    captureBrowserErrorsIntegration(),
    captureFetchIntegration(),
    pageLifecycleIntegration(),
  ],
});

document.querySelector("#manual")?.addEventListener("click", () => {
  logger.info("button clicked", { token: "client-secret" });
});

document.querySelector("#fetch-error")?.addEventListener("click", async () => {
  await fetch("/api/does-not-exist");
});

console.warn("console warning captured", { feature: "demo" });
