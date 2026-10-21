import { randomUUID } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  estimateMaxCostMicros,
  estimateModelCostUsd,
  type ModelPolicyResolver,
} from '../../../modules/models/services/model-policy.service';
import type { CreditAuthorizationService } from '../../billing/services/credit-authorization.service';
import { RESERVATION_LIFETIME_MS } from '../../billing/services/reservation.service';
import { createRequestDeadline, DEFAULT_REQUEST_DEADLINE_MS } from '../../common/request-deadline';
import type { ChatCompletionChunkDTO } from '../dto/chat-completion.dto';
import { validateChatCompletionRequest } from '../dto/chat-completion.dto';
import type { ChatCompletionService } from '../services/chat-completion.service';
/**
 * The number of tokens of the prompt is not known before the provider
 * processed the request. The size of the body is an upper bound, a token can
 * not be shorter than a byte. The bound is only used for the reservation, the
 * settlement uses the token counts of the provider.
 */
function estimatePromptTokenBound(request: FastifyRequest): number {
  const contentLength = Number(request.headers['content-length'] ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 0) {
    return contentLength;
  }
  try {
    return JSON.stringify(request.body ?? {}).length;
  } catch {
    return 0;
  }
}

export function createChatCompletionController(
  chatService: ChatCompletionService,
  policyResolver: ModelPolicyResolver,
  creditAuthorization: CreditAuthorizationService,
  requestDeadlineMs: number = DEFAULT_REQUEST_DEADLINE_MS,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const dto = validateChatCompletionRequest(request.body);

    // The catalogue decides which provider serves the model and what it
    // costs. A model that is unknown or without a trusted price is rejected
    // before the request reaches a provider.
    const policy = await policyResolver.resolve(dto.model, dto.provider);
    policyResolver.assertModality(policy, 'chat');
    dto.provider = policy.providerSlug;
    dto.model = policy.modelId;

    // The credit of the request is reserved before it is forwarded to the
    // provider. A request without a reservation is not sent to a provider.
    // The usage key identifies the request, it is the idempotency key of the
    // reservation and of the usage event.
    const usageKey = randomUUID();
    const organizationId = request.apiKey?.organizationId ?? null;
    const reservationId = organizationId
      ? await creditAuthorization.reserve({
          organizationId,
          apiKeyId: request.apiKey?.id ?? null,
          requestId: request.id,
          idempotencyKey: usageKey,
          modality: 'chat',
          amountMicros: estimateMaxCostMicros(policy, 'chat', {
            promptTokens: estimatePromptTokenBound(request),
            completionTokens: dto.max_tokens,
          }),
          expiresAt: new Date(Date.now() + RESERVATION_LIFETIME_MS),
        })
      : null;

    request.usageMetadata = {
      provider: policy.providerSlug,
      model: policy.modelId,
      usageKey,
      ...(reservationId ? { reservationId } : {}),
    };

    const abortController = new AbortController();
    // The request stream ends as soon as the body was consumed, which happens
    // long before the response is written. Listening on the request would
    // therefore abort every provider call immediately. The response reports
    // the real client disconnect: it is closed without being ended.
    const handleClose = () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
      }
    };
    reply.raw.on('close', handleClose);

    // The lease of the reservation keeps the credit of the request reserved
    // while the request is running. Without it, a request that outlives the
    // deadline of its reservation would lose its credit while the provider is
    // still working on it.
    const lease = creditAuthorization.startLease(reservationId, (reason) => {
      abortController.abort(
        new Error(`The credit guarantee of the request was lost: ${reason} (timeout)`),
      );
    });

    // The deadline bounds the whole request. The provider timeout only bounds
    // a single provider call, a request can be retried and can fall back to
    // another provider.
    const deadline = createRequestDeadline(requestDeadlineMs);

    const options = { signal: abortController.signal };

    try {
      if (!dto.stream) {
        try {
          const responseDTO = await chatService.createCompletion(dto, options);
          if (responseDTO.usage) {
            request.usageMetadata = {
              ...request.usageMetadata,
              promptTokens: responseDTO.usage.prompt_tokens,
              completionTokens: responseDTO.usage.completion_tokens,
              totalTokens: responseDTO.usage.total_tokens,
              estimatedCost: estimateModelCostUsd(policy, 'chat', {
                promptTokens: responseDTO.usage.prompt_tokens,
                completionTokens: responseDTO.usage.completion_tokens,
              }),
            };
          }
          void reply.status(200).send(responseDTO);
        } finally {
          reply.raw.removeListener('close', handleClose);
        }
        return;
      }

      // Resolve stream BEFORE hijacking/sending HTTP 200 OK headers
      let stream: AsyncIterable<ChatCompletionChunkDTO>;
      try {
        stream = await chatService.getCompletionStream(dto, options);
      } catch (err) {
        reply.raw.removeListener('close', handleClose);
        throw err;
      }

      // Streaming SSE flow
      reply.hijack();

      try {
        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('X-Accel-Buffering', 'no');
        reply.raw.writeHead(200);

        for await (const chunk of stream) {
          // The request stream is destroyed as soon as the body was consumed,
          // so only the response tells whether the client is still connected.
          if (reply.raw.destroyed || abortController.signal.aborted) {
            break;
          }

          const payload = `data: ${JSON.stringify(chunk)}\n\n`;
          if (chunk.usage) {
            request.usageMetadata = {
              ...request.usageMetadata,
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
              estimatedCost: estimateModelCostUsd(policy, 'chat', {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
              }),
            };
          }
          const canContinue = reply.raw.write(payload);
          if (!canContinue) {
            await new Promise<void>((resolve) => reply.raw.once('drain', resolve));
          }
        }

        if (!reply.raw.destroyed && !abortController.signal.aborted) {
          reply.raw.write('data: [DONE]\n\n');
        }
      } catch (err: unknown) {
        const errorObj = err as { code?: string; message?: string };
        const errPayload = JSON.stringify({
          error: {
            code: errorObj?.code || 'STREAM_ERROR',
            message: errorObj?.message || 'An error occurred during streaming',
          },
        });
        reply.raw.write(`data: ${errPayload}\n\n`);
      } finally {
        reply.raw.removeListener('close', handleClose);
        if (!reply.raw.destroyed) {
          reply.raw.end();
        }
      }
    } finally {
      // The lease ends with the request. The credit of a request that failed
      // after the provider was called stays reserved until the deadline of the
      // reservation passes, the recovery returns it.
      deadline.cancel();
      lease?.stop();
      reply.raw.removeListener('close', handleClose);
    }
  };
}
