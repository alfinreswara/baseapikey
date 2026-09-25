import type {
  ChatRole,
  ProviderModel,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
} from '@baseapikey/shared';

import type {
  NineRouterWireModel,
  NineRouterWireRequest,
  NineRouterWireResponse,
  NineRouterWireStreamChunk,
} from './9router.types';

function parseChatRole(role?: string | null): ChatRole {
  if (
    role === 'system' ||
    role === 'user' ||
    role === 'assistant' ||
    role === 'tool' ||
    role === 'developer'
  ) {
    return role;
  }
  return 'assistant';
}

function parseFinishReason(
  reason?: string | null,
): 'stop' | 'length' | 'tool_calls' | 'content_filter' | null {
  if (
    reason === 'stop' ||
    reason === 'length' ||
    reason === 'tool_calls' ||
    reason === 'content_filter'
  ) {
    return reason;
  }
  return null;
}

/**
 * Transforms normalized internal ProviderRequest to 9Router wire request payload.
 */
export function mapToNineRouterRequest(
  request: ProviderRequest,
  overrideStream?: boolean,
): NineRouterWireRequest {
  return {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    })),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.top_p !== undefined ? { top_p: request.top_p } : {}),
    ...(request.max_tokens !== undefined ? { max_tokens: request.max_tokens } : {}),
    stream: overrideStream !== undefined ? overrideStream : (request.stream ?? false),
    ...(request.stop !== undefined ? { stop: request.stop } : {}),
    ...(request.presence_penalty !== undefined
      ? { presence_penalty: request.presence_penalty }
      : {}),
    ...(request.frequency_penalty !== undefined
      ? { frequency_penalty: request.frequency_penalty }
      : {}),
    ...(request.user !== undefined ? { user: request.user } : {}),
    ...(request.tools ? { tools: request.tools } : {}),
    ...(request.tool_choice ? { tool_choice: request.tool_choice } : {}),
    ...(request.response_format ? { response_format: request.response_format } : {}),
  };
}

/**
 * Transforms 9Router wire response to normalized ProviderResponse.
 */
export function mapFromNineRouterResponse(
  wire: NineRouterWireResponse,
  providerSlug = '9router',
): ProviderResponse {
  const promptTokens = wire.usage?.prompt_tokens ?? 0;
  const completionTokens = wire.usage?.completion_tokens ?? 0;
  const totalTokens = wire.usage?.total_tokens ?? promptTokens + completionTokens;

  return {
    id: wire.id,
    object: 'chat.completion',
    created: wire.created ?? Math.floor(Date.now() / 1000),
    model: wire.model,
    provider: providerSlug,
    choices: (wire.choices ?? []).map((c) => ({
      index: c.index,
      message: {
        role: parseChatRole(c.message.role),
        content: c.message.content ?? '',
      },
      finish_reason: parseFinishReason(c.finish_reason),
    })),
    ...(wire.usage
      ? {
          usage: {
            promptTokens,
            completionTokens,
            totalTokens,
          },
        }
      : {}),
  };
}

/**
 * Transforms 9Router wire stream chunk to normalized ProviderStreamChunk.
 */
export function mapFromNineRouterStreamChunk(
  wire: NineRouterWireStreamChunk,
  providerSlug = '9router',
): ProviderStreamChunk {
  return {
    id: wire.id,
    object: 'chat.completion.chunk',
    created: wire.created ?? Math.floor(Date.now() / 1000),
    model: wire.model,
    provider: providerSlug,
    choices: (wire.choices ?? []).map((c) => ({
      index: c.index,
      delta: {
        ...(c.delta.role ? { role: parseChatRole(c.delta.role) } : {}),
        content: c.delta.content ?? null,
      },
      finish_reason: parseFinishReason(c.finish_reason),
    })),
  };
}

/**
 * Transforms 9Router wire model item to normalized ProviderModel.
 */
export function mapFromNineRouterModel(
  wire: NineRouterWireModel,
  providerSlug = '9router',
): ProviderModel {
  return {
    id: wire.id,
    object: 'model',
    created: wire.created ?? Math.floor(Date.now() / 1000),
    owned_by: wire.owned_by ?? '9router',
    provider: providerSlug,
    context_length: wire.context_length ?? 128000,
    capabilities: {
      supportsChat: wire.supports_chat ?? true,
      supportsStreaming: wire.supports_streaming ?? true,
      supportsModels: true,
      supportsTools: true,
      supportsVision: false,
    },
  };
}
