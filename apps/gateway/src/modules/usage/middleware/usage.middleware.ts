import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { QuotaService } from '../../quota/services/quota.service';
import type { CreateUsageRecordDto } from '../dto/usage.dto';
import type { IUsageCostResolver } from '../services/usage-cost.service';
import type { IUsageRecorder } from '../services/usage-recorder';

declare module 'fastify' {
  interface FastifyRequest {
    startTime?: number;
    usageMetadata?: {
      provider?: string;
      model?: string;
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      estimatedCost?: number;
    };
  }
}

export function registerUsageTrackingHook(
  fastify: FastifyInstance,
  usageRecorder: IUsageRecorder,
  quotaService?: QuotaService,
  costResolver?: IUsageCostResolver,
): void {
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    request.startTime = Date.now();
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    // Track requests authenticated via API Key (request.apiKey and request.user present)
    const apiKeyContext = request.apiKey;
    const userContext = request.user;

    if (!apiKeyContext || !userContext) {
      return;
    }

    const startTime = request.startTime ?? Date.now();
    const latencyMs = Math.max(0, Date.now() - startTime);

    const meta = request.usageMetadata ?? {};
    const promptTokens = meta.promptTokens ?? 0;
    const completionTokens = meta.completionTokens ?? 0;
    const totalTokens = meta.totalTokens ?? promptTokens + completionTokens;
    let estimatedCost = meta.estimatedCost ?? 0;
    if (meta.estimatedCost === undefined && costResolver && totalTokens > 0) {
      try {
        estimatedCost = await costResolver.estimate({
          provider: meta.provider ?? 'default',
          model: meta.model ?? 'default',
          promptTokens,
          completionTokens,
          totalTokens,
        });
      } catch {
        // Cost resolution is best effort; the usage event is still retained for reconciliation.
      }
    }

    const dto: CreateUsageRecordDto = {
      userId: userContext.userId,
      apiKeyId: apiKeyContext.id,
      organizationId: apiKeyContext.organizationId ?? null,
      provider: meta.provider ?? 'default',
      model: meta.model ?? 'default',
      endpoint: request.routeOptions.url ?? request.url.split('?')[0] ?? request.url,
      method: request.method,
      requestId: request.id,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCost,
      latencyMs,
      statusCode: reply.statusCode,
      clientIp: request.ip,
      userAgent:
        typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
    };

    usageRecorder.record(dto);

    if (quotaService && (totalTokens > 0 || dto.estimatedCost > 0)) {
      try {
        await quotaService.recordUsageQuota(apiKeyContext.id, 0, totalTokens, dto.estimatedCost);
      } catch {
        // Usage accounting must not alter a response that has already been sent.
      }
    }
  });
}
