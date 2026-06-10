import { createLogger, stdoutTransport, captureProcessIntegration } from "@loggerjs/node";
import { redactProcessor, tagsProcessor } from "@loggerjs/processors";

const logLevels = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;
const level = logLevels.find((candidate) => candidate === process.env.LOG_LEVEL) ?? "info";

const logger = createLogger({
  name: "api",
  level,
  tags: { service: "checkout", env: process.env.NODE_ENV ?? "dev" },
  processors: [redactProcessor(), tagsProcessor({ runtime: "node" })],
  transports: [stdoutTransport()],
  integrations: [captureProcessIntegration()],
});

logger.info("server started", { port: 3000 });
logger.warn("payment retry", { orderId: "ord_123", token: "secret-token" });

try {
  throw new Error("demo failure");
} catch (error) {
  logger.captureException(error, { orderId: "ord_123" });
}

await logger.flush();
