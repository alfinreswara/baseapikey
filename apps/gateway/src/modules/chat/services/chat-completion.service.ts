import type { ProviderRegistry, ProviderRequestOptions } from '@baseapikey/shared';

import { ResilientProviderRouter } from '../../providers/resilience/resilient-provider-router';
import type {
  ChatCompletionChunkDTO,
  ChatCompletionRequestDTO,
  ChatCompletionResponseDTO,
} from '../dto/chat-completion.dto';
import { mapDTOToProviderRequest, mapProviderStreamChunkToDTO } from '../dto/chat-completion.dto';

export class ChatCompletionService {
  private readonly resilientRouter: ResilientProviderRouter;

  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly defaultProviderSlug = '9router',
    resilientRouter?: ResilientProviderRouter,
    private readonly modelResolver?: {
      resolveModel(modelId: string): Promise<{ provider: { slug: string } }>;
    },
  ) {
    this.resilientRouter = resilientRouter ?? new ResilientProviderRouter(providerRegistry);
  }

  async createCompletion(
    dto: ChatCompletionRequestDTO,
    options?: ProviderRequestOptions,
  ): Promise<ChatCompletionResponseDTO> {
    const targetProviderId = await this.resolveProvider(dto.model, dto.provider);
    const providerReq = mapDTOToProviderRequest(dto);
    const providerRes = await this.resilientRouter.execute(
      targetProviderId,
      (provider) => provider.chat(providerReq, options),
      options,
      'supportsChat',
    );

    return {
      id: providerRes.id,
      object: 'chat.completion',
      created: providerRes.created,
      model: providerRes.model,
      choices: providerRes.choices.map((c) => ({
        index: c.index,
        message: {
          role: c.message.role,
          content: typeof c.message.content === 'string' ? c.message.content : '',
        },
        finish_reason: c.finish_reason,
      })),
      ...(providerRes.usage
        ? {
            usage: {
              prompt_tokens: providerRes.usage.promptTokens,
              completion_tokens: providerRes.usage.completionTokens,
              total_tokens: providerRes.usage.totalTokens,
            },
          }
        : {}),
    };
  }

  async getCompletionStream(
    dto: ChatCompletionRequestDTO,
    options?: ProviderRequestOptions,
  ): Promise<AsyncIterable<ChatCompletionChunkDTO>> {
    const targetProviderId = await this.resolveProvider(dto.model, dto.provider);
    const providerReq = mapDTOToProviderRequest(dto);
    const stream = await this.resilientRouter.execute(
      targetProviderId,
      (provider) => provider.streamChat(providerReq, options),
      options,
      'supportsStreaming',
    );

    async function* transformStream() {
      for await (const chunk of stream) {
        yield mapProviderStreamChunkToDTO(chunk);
      }
    }

    return transformStream();
  }

  // Alias for backward compatibility
  async createStreamCompletion(
    dto: ChatCompletionRequestDTO,
    options?: ProviderRequestOptions,
  ): Promise<AsyncIterable<ChatCompletionChunkDTO>> {
    return this.getCompletionStream(dto, options);
  }

  private async resolveProvider(model: string, requestedProvider?: string): Promise<string> {
    if (requestedProvider) return requestedProvider;
    if (!this.modelResolver) return this.defaultProviderSlug;
    try {
      return (await this.modelResolver.resolveModel(model)).provider.slug;
    } catch {
      return this.defaultProviderSlug;
    }
  }
}
