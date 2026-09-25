import { createLogger } from './logger';
import { logIncomingRequest, logCompletedRequest, registerGlobalErrorHandlers } from './middleware';

const logger = createLogger({
  serviceName: 'test-service',
  environment: 'test',
  requestId: 'req_123456',
  isDevelopment: false,
});

// Verify log helper methods
logger.trace('trace log test');
logger.debug('debug log test');
logger.info('info log test');
logger.warn('warn log test');
logger.error('error log test');
logger.fatal('fatal log test');

// Test request logging helpers
logIncomingRequest(logger, {
  method: 'GET',
  url: '/v1/models',
  requestId: 'req_123456',
});

logCompletedRequest(
  logger,
  {
    method: 'GET',
    url: '/v1/models',
    requestId: 'req_123456',
  },
  200,
  12.5,
);

// Register global error handlers
registerGlobalErrorHandlers(logger);

console.log('Logger foundation tests passed successfully.');
