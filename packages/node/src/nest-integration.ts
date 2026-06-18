import type { LoggerLike } from "@loggerjs/core";
import {
  expressIntegration,
  type ExpressIntegrationOptions,
  type ExpressRequestHandler,
} from "./express-integration";

export type NestMiddleware = ExpressRequestHandler;

/**
 * Express-compatible Nest middleware adapter. It observes the same request and
 * response completion surface as `expressIntegration`; it does not hook Nest
 * exception filters, interceptors, guards, or the original thrown `Error`.
 */
export function nestMiddlewareIntegration(
  logger: LoggerLike,
  options: ExpressIntegrationOptions = {},
): NestMiddleware {
  return expressIntegration(logger, {
    name: "nestjs",
    ...options,
  });
}
