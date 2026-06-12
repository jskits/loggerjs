import type { LoggerLike } from "@loggerjs/core";
import {
  expressIntegration,
  type ExpressIntegrationOptions,
  type ExpressRequestHandler,
} from "./express-integration";

export type NestMiddleware = ExpressRequestHandler;

export function nestMiddlewareIntegration(
  logger: LoggerLike,
  options: ExpressIntegrationOptions = {},
): NestMiddleware {
  return expressIntegration(logger, {
    name: "nestjs",
    ...options,
  });
}
