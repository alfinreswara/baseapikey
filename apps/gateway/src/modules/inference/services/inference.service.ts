import {
  ProviderError,
  type ProviderBinaryResponse,
  type ProviderEmbeddingResponse,
  type ProviderImageResponse,
  type ProviderRegistry,
  type ProviderRequestOptions,
  type ProviderTranscriptionResponse,
} from '@baseapikey/shared';

import { ResilientProviderRouter } from '../../providers/resilience/resilient-provider-router';
import type {
  EmbeddingDto,
  ImageGenerationDto,
  SpeechDto,
  TranscriptionFieldsDto,
} from '../dto/inference.dto';
import type { ParsedAudioMultipart } from '../utils/multipart.util';

export class InferenceService {
  private readonly router: ResilientProviderRouter;

  constructor(
    registry: ProviderRegistry,
    private readonly defaultProviderSlug = '9router',
    router?: ResilientProviderRouter,
    private readonly modelResolver?: {
      resolveModel(modelId: string): Promise<{ provider: { slug: string } }>;
    },
  ) {
    this.router = router ?? new ResilientProviderRouter(registry);
  }

  async createEmbedding(
    dto: EmbeddingDto,
    options?: ProviderRequestOptions,
  ): Promise<ProviderEmbeddingResponse> {
    const { provider, ...request } = dto;
    const providerId = await this.resolveProvider(dto.model, provider);
    return this.router.execute(
      providerId,
      (provider) => {
        if (!provider.createEmbedding) throw this.unsupported(provider.getName(), 'embeddings');
        return provider.createEmbedding(request, options);
      },
      options,
      'supportsEmbeddings',
    );
  }

  async createImage(
    dto: ImageGenerationDto,
    options?: ProviderRequestOptions,
  ): Promise<ProviderImageResponse> {
    const { provider, ...request } = dto;
    const providerId = await this.resolveProvider(dto.model, provider);
    return this.router.execute(
      providerId,
      (provider) => {
        if (!provider.createImage) throw this.unsupported(provider.getName(), 'images');
        return provider.createImage(request, options);
      },
      options,
      'supportsImages',
    );
  }

  async createSpeech(
    dto: SpeechDto,
    options?: ProviderRequestOptions,
  ): Promise<ProviderBinaryResponse> {
    const { provider, ...request } = dto;
    const providerId = await this.resolveProvider(dto.model, provider);
    return this.router.execute(
      providerId,
      (provider) => {
        if (!provider.createSpeech) throw this.unsupported(provider.getName(), 'audio speech');
        return provider.createSpeech(request, options);
      },
      options,
      'supportsAudio',
    );
  }

  async transcribeAudio(
    fields: TranscriptionFieldsDto,
    file: ParsedAudioMultipart['file'],
    options?: ProviderRequestOptions,
  ): Promise<ProviderTranscriptionResponse> {
    const { provider, ...request } = fields;
    const providerId = await this.resolveProvider(fields.model, provider);
    return this.router.execute(
      providerId,
      (provider) => {
        if (!provider.transcribeAudio) {
          throw this.unsupported(provider.getName(), 'audio transcription');
        }
        return provider.transcribeAudio(
          {
            ...request,
            file: file.data,
            filename: file.filename,
            contentType: file.contentType,
          },
          options,
        );
      },
      options,
      'supportsAudio',
    );
  }

  private unsupported(provider: string, feature: string): ProviderError {
    return new ProviderError({
      code: 'PROVIDER_CAPABILITY_UNSUPPORTED',
      message: `Provider '${provider}' does not support ${feature}`,
      statusCode: 400,
      category: 'INVALID_REQUEST',
      isRetryable: false,
      providerSlug: provider,
    });
  }

  private async resolveProvider(model: string | undefined, requested?: string): Promise<string> {
    if (requested) return requested;
    if (!model || !this.modelResolver) return this.defaultProviderSlug;
    try {
      return (await this.modelResolver.resolveModel(model)).provider.slug;
    } catch {
      return this.defaultProviderSlug;
    }
  }
}
