import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import type { QuotaService } from '../services/quota.service';

export function requireQuota(quotaService: QuotaService): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    // 1. Quota enforcement applies to requests authenticated with an API key
    const apiKeyContext = request.apiKey;
    if (!apiKeyContext) {
      return;
    }

    // 2. Check and enforce quota limits before request processing
    await quotaService.checkAndEnforceQuota(apiKeyContext.id);

    // 3. Immediately increment minute and daily request counters
    await quotaService.recordUsageQuota(apiKeyContext.id, 1, 0, 0);
  };
}
