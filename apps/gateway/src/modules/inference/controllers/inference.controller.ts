import type { FastifyReply, FastifyRequest } from 'fastify';

import type { CreditAuthorizationService } from '../../billing/services/credit-authorization.service';
import { RESERVATION_LIFETIME_MS } from '../../billing/services/reservation.service';
import { createRequestDeadline, DEFAULT_REQUEST_DEADLINE_MS } from '../../common/request-deadline';
import {
  estimateMaxCostMicros,
  estimateModelCostUsd,
  type ModalityUsage,
  type ModelCategory,
  type ModelModality,
  type ModelPolicy,
  type ModelPolicyResolver,
} from '../../models/services/model-policy.service';
import {
  EmbeddingSchema,
  ImageGenerationSchema,
  parseInferenceDto,
  SpeechSchema,
  TranscriptionFieldsSchema,
} from '../dto/inference.dto';
import type { InferenceService } from '../services/inference.service';
import { parseAudioMultipart } from '../utils/multipart.util';

/**
 * The number of tokens of an embedding input is not known before the provider
 * processed the request. The size of the input is an upper bound, a token can
 * not be shorter than a byte.
 */
function estimateEmbeddingTokenBound(input: unknown): number {
  if (typeof input === 'string') return input.length;
  if (Array.isArray(input)) {
    return input.reduce((total: number, item: unknown) => {
      if (typeof item === 'string') return total + item.length;
      if (Array.isArray(item)) return total + item.length;
      return total + 1;
    }, 0);
  }
  return 0;
}

export class InferenceController {
  constructor(
    private readonly service: InferenceService,
    private readonly policyResolver: ModelPolicyResolver,
    private readonly creditAuthorization: CreditAuthorizationService,
    private readonly requestDeadlineMs: number = DEFAULT_REQUEST_DEADLINE_MS,
  ) {}

  /**
   * Reserves the credit of the request before it is forwarded to a provider.
   * A modality without a verifiable price is rejected before the provider is
   * called.
   */
  private async authorize(
    request: FastifyRequest,
    policy: ModelPolicy,
    modality: ModelModality,
    usage: ModalityUsage,
  ): Promise<string | null> {
    this.policyResolver.assertModality(policy, modality);
    const organizationId = request.apiKey?.organizationId ?? null;
    if (!organizationId) {
      return null;
    }
    return this.creditAuthorization.reserve({
      organizationId,
      apiKeyId: request.apiKey?.id ?? null,
      requestId: request.id,
      idempotencyKey: request.usageMetadata?.usageKey ?? request.id,
      modality,
      amountMicros: estimateMaxCostMicros(policy, modality, usage),
      expiresAt: new Date(Date.now() + RESERVATION_LIFETIME_MS),
    });
  }

  /**
   * Resolves the policy of the model before the request reaches a provider.
   * The catalogue decides the provider and the price, a client can not route
   * around the mapping and a model without a trusted price is rejected.
   */
  private async resolvePolicy(
    model: string,
    provider: string | undefined,
    category: ModelCategory,
  ) {
    const policy = await this.policyResolver.resolve(model, provider);
    this.policyResolver.assertCategory(policy, category);
    return policy;
  }

  async embedding(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const dto = parseInferenceDto(EmbeddingSchema, request.body);
    const policy = await this.resolvePolicy(dto.model, dto.provider, 'EMBEDDING');
    dto.provider = policy.providerSlug;
    dto.model = policy.modelId;
    const reservationId = await this.authorize(request, policy, 'embedding', {
      promptTokens: estimateEmbeddingTokenBound(dto.input),
    });
    request.usageMetadata = {
      provider: policy.providerSlug,
      model: policy.modelId,
      ...(reservationId ? { reservationId } : {}),
    };
    const result = await this.withAbort(
      reply,
      (signal) => this.service.createEmbedding(dto, { signal }),
      reservationId,
    );
    request.usageMetadata = {
      ...request.usageMetadata,
      promptTokens: result.usage.prompt_tokens,
      totalTokens: result.usage.total_tokens,
      estimatedCost: estimateModelCostUsd(policy, 'embedding', {
        promptTokens: result.usage.prompt_tokens,
      }),
    };
    void reply.status(200).send(result);
  }

  async image(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const dto = parseInferenceDto(ImageGenerationSchema, request.body);
    const policy = await this.resolvePolicy(
      dto.model ?? 'default-image-model',
      dto.provider,
      'IMAGE',
    );
    dto.provider = policy.providerSlug;
    dto.model = policy.modelId;
    const reservationId = await this.authorize(request, policy, 'image', {
      images: dto.n ?? 1,
    });
    request.usageMetadata = {
      provider: policy.providerSlug,
      model: policy.modelId,
      ...(reservationId ? { reservationId } : {}),
    };
    const result = await this.withAbort(
      reply,
      (signal) => this.service.createImage(dto, { signal }),
      reservationId,
    );
    request.usageMetadata = {
      ...request.usageMetadata,
      estimatedCost: estimateModelCostUsd(policy, 'image', {
        images: Array.isArray(result.data) ? result.data.length : (dto.n ?? 1),
      }),
    };
    void reply.status(200).send(result);
  }

  async speech(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const dto = parseInferenceDto(SpeechSchema, request.body);
    const policy = await this.resolvePolicy(dto.model, dto.provider, 'AUDIO');
    dto.provider = policy.providerSlug;
    dto.model = policy.modelId;
    const reservationId = await this.authorize(request, policy, 'speech', {
      characters: dto.input.length,
    });
    request.usageMetadata = {
      provider: policy.providerSlug,
      model: policy.modelId,
      ...(reservationId ? { reservationId } : {}),
    };
    const result = await this.withAbort(
      reply,
      (signal) => this.service.createSpeech(dto, { signal }),
      reservationId,
    );
    request.usageMetadata = {
      ...request.usageMetadata,
      estimatedCost: estimateModelCostUsd(policy, 'speech', {
        characters: dto.input.length,
      }),
    };
    void reply
      .header('Content-Type', result.contentType)
      .status(200)
      .send(Buffer.from(result.data));
  }

  async transcription(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!Buffer.isBuffer(request.body)) {
      throw new Error('Expected a multipart/form-data body');
    }
    const contentType = request.headers['content-type'] ?? '';
    const multipart = parseAudioMultipart(request.body, contentType);
    const fields = parseInferenceDto(TranscriptionFieldsSchema, multipart.fields);
    const policy = await this.resolvePolicy(fields.model, fields.provider, 'AUDIO');
    fields.provider = policy.providerSlug;
    fields.model = policy.modelId;
    const reservationId = await this.authorize(request, policy, 'transcription', {
      bytes: multipart.file.data.length,
    });
    request.usageMetadata = {
      provider: policy.providerSlug,
      model: policy.modelId,
      ...(reservationId ? { reservationId } : {}),
    };
    const result = await this.withAbort(
      reply,
      (signal) => this.service.transcribeAudio(fields, multipart.file, { signal }),
      reservationId,
    );
    if (typeof result === 'string') {
      void reply.type('text/plain; charset=utf-8').status(200).send(result);
    } else {
      void reply.status(200).send(result);
    }
  }

  private async withAbort<T>(
    reply: FastifyReply,
    operation: (signal: AbortSignal) => Promise<T>,
    reservationId: string | null = null,
  ): Promise<T> {
    const controller = new AbortController();
    // The request stream ends as soon as the body was consumed, which is not
    // a client disconnect. The response reports the real disconnect: it is
    // closed without being ended.
    const onClose = () => {
      if (!reply.raw.writableEnded) {
        controller.abort();
      }
    };
    reply.raw.on('close', onClose);

    // The lease of the reservation keeps the credit of the request reserved
    // while the request is running.
    const lease = this.creditAuthorization.startLease(reservationId, (reason) => {
      controller.abort(
        new Error(`The credit guarantee of the request was lost: ${reason} (timeout)`),
      );
    });

    // The deadline bounds the whole request, the provider timeout only bounds
    // a single provider call.
    const deadline = createRequestDeadline(this.requestDeadlineMs);

    try {
      return await operation(controller.signal);
    } finally {
      deadline.cancel();
      lease?.stop();
      reply.raw.removeListener('close', onClose);
    }
  }
}
