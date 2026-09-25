import pino, { LoggerOptions as PinoLoggerOptions, Logger, Level } from 'pino';

import { defaultRedactionPaths } from './redaction';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface CreateLoggerOptions {
  serviceName: string;
  level?: LogLevel | string;
  environment?: string;
  requestId?: string;
  isDevelopment?: boolean;
  redactPaths?: string[];
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const environment = options.environment || process.env['NODE_ENV'] || 'development';
  const isDev = options.isDevelopment ?? (environment === 'development' || environment === 'test');
  const level = options.level || process.env['LOG_LEVEL'] || (isDev ? 'debug' : 'info');

  const baseBindings: Record<string, unknown> = {
    serviceName: options.serviceName,
    environment,
  };

  if (options.requestId) {
    baseBindings['requestId'] = options.requestId;
  }

  const pinoOptions: PinoLoggerOptions = {
    level: level as Level,
    base: baseBindings,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    redact: {
      paths: options.redactPaths || defaultRedactionPaths,
      censor: '[REDACTED]',
    },
  };

  if (isDev) {
    pinoOptions.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(pinoOptions);
}
