import { createLogger } from "@loggerjs/core";
import { sentryTransport, type SentryLike } from "@loggerjs/sentry";

const sentry: SentryLike = {
  logger: {
    info(message, attributes) {
      console.info("sentry log", message, attributes);
    },
    error(message, attributes) {
      console.error("sentry log", message, attributes);
    },
  },
  addBreadcrumb(breadcrumb) {
    console.info("breadcrumb", breadcrumb);
  },
  captureException(error, context) {
    console.error("captured exception", error, context);
    return "event-id";
  },
};

const logger = createLogger({
  name: "sentry-example",
  transports: [sentryTransport({ sentry, captureMessages: true })],
});

logger.info("sentry message", { feature: "demo" });
logger.captureException(new Error("demo failure"), { orderId: "ord_123" });
await logger.flush();
