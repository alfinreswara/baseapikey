import type { Logger } from 'pino';

export interface RequestLogDetails {
  method: string;
  url: string;
  path?: string;
  headers?: Record<string, unknown>;
  requestId?: string;
}

export function logIncomingRequest(logger: Logger, req: RequestLogDetails): void {
  logger.info(
    {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      path: req.path || req.url,
      headers: req.headers,
    },
    `Incoming request: ${req.method} ${req.url}`,
  );
}

export function logCompletedRequest(
  logger: Logger,
  req: RequestLogDetails,
  statusCode: number,
  responseTimeMs: number,
): void {
  const logData = {
    requestId: req.requestId,
    method: req.method,
    url: req.url,
    statusCode,
    responseTimeMs,
  };

  if (statusCode >= 500) {
    logger.error(
      logData,
      `Request failed: ${req.method} ${req.url} - ${statusCode} (${responseTimeMs.toFixed(2)}ms)`,
    );
  } else if (statusCode >= 400) {
    logger.warn(
      logData,
      `Request client error: ${req.method} ${req.url} - ${statusCode} (${responseTimeMs.toFixed(2)}ms)`,
    );
  } else {
    logger.info(
      logData,
      `Request completed: ${req.method} ${req.url} - ${statusCode} (${responseTimeMs.toFixed(2)}ms)`,
    );
  }
}

export function registerGlobalErrorHandlers(logger: Logger): void {
  process.on('uncaughtException', (error: Error) => {
    logger.fatal({ err: error }, `Uncaught Exception: ${error.message}`);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    if (reason instanceof Error) {
      logger.fatal({ err: reason }, `Unhandled Promise Rejection: ${reason.message}`);
    } else {
      logger.fatal({ reason }, `Unhandled Promise Rejection: ${String(reason)}`);
    }
  });
}
