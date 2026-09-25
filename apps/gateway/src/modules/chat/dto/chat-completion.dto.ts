import type { ChatMessage, ProviderRequest, ProviderStreamChunk } from '@baseapikey/shared';
import { ValidationError } from '@baseapikey/shared';

export interface ChatCompletionMessageDTO {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content: string | unknown[];
  name?: string | undefined;
}

export interface ChatCompletionRequestDTO {
  model: string;
  messages: ChatCompletionMessageDTO[];
  temperature?: number | undefined;
  top_p?: number | undefined;
  max_tokens?: number | undefined;
  stream?: boolean | undefined;
  stop?: string | string[] | undefined;
  presence_penalty?: number | undefined;
  frequency_penalty?: number | undefined;
  user?: string | undefined;
  tools?: unknown[] | undefined;
  tool_choice?: unknown | undefined;
  response_format?: { type: 'text' | 'json_object' } | undefined;
  provider?: string | undefined;
}

export interface ChatCompletionChoiceDTO {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface ChatCompletionChunkChoiceDTO {
  index: number;
  delta: {
    role?: string | undefined;
    content?: string | null | undefined;
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface ChatCompletionUsageDTO {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponseDTO {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoiceDTO[];
  usage?: ChatCompletionUsageDTO | undefined;
}

export interface ChatCompletionChunkDTO {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoiceDTO[];
  usage?: ChatCompletionUsageDTO | undefined;
}

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant', 'tool', 'developer']);

/**
 * Validates external ChatCompletionRequestDTO
 */
export function validateChatCompletionRequest(body: unknown): ChatCompletionRequestDTO {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body must be a JSON object');
  }

  const req = body as Partial<ChatCompletionRequestDTO>;

  if (typeof req.model !== 'string' || !req.model.trim()) {
    throw new ValidationError('Property "model" is required and must be a non-empty string');
  }

  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    throw new ValidationError('Property "messages" is required and must be a non-empty array');
  }

  for (let i = 0; i < req.messages.length; i++) {
    const msg = req.messages[i];
    if (!msg || typeof msg !== 'object') {
      throw new ValidationError(`Message at index ${i} must be an object`);
    }

    if (!msg.role || typeof msg.role !== 'string' || !ALLOWED_ROLES.has(msg.role)) {
      throw new ValidationError(
        `Message at index ${i} has invalid role "${String(msg.role)}". Allowed roles: system, user, assistant, tool, developer`,
      );
    }

    if (
      msg.content === undefined ||
      msg.content === null ||
      (typeof msg.content !== 'string' && !Array.isArray(msg.content))
    ) {
      throw new ValidationError(`Message at index ${i} content must be a string or content array`);
    }
  }

  if (req.temperature !== undefined) {
    if (typeof req.temperature !== 'number' || req.temperature < 0 || req.temperature > 2) {
      throw new ValidationError('Property "temperature" must be a number between 0 and 2');
    }
  }

  if (req.top_p !== undefined) {
    if (typeof req.top_p !== 'number' || req.top_p < 0 || req.top_p > 1) {
      throw new ValidationError('Property "top_p" must be a number between 0 and 1');
    }
  }

  if (req.max_tokens !== undefined) {
    if (
      typeof req.max_tokens !== 'number' ||
      !Number.isInteger(req.max_tokens) ||
      req.max_tokens <= 0
    ) {
      throw new ValidationError('Property "max_tokens" must be a positive integer');
    }
  }

  if (req.stream !== undefined && typeof req.stream !== 'boolean') {
    throw new ValidationError('Property "stream" must be a boolean');
  }

  return {
    model: req.model.trim(),
    messages: req.messages as ChatCompletionMessageDTO[],
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.top_p !== undefined ? { top_p: req.top_p } : {}),
    ...(req.max_tokens !== undefined ? { max_tokens: req.max_tokens } : {}),
    stream: Boolean(req.stream),
    ...(req.stop !== undefined ? { stop: req.stop } : {}),
    ...(req.presence_penalty !== undefined ? { presence_penalty: req.presence_penalty } : {}),
    ...(req.frequency_penalty !== undefined ? { frequency_penalty: req.frequency_penalty } : {}),
    ...(req.user !== undefined ? { user: req.user } : {}),
    ...(req.tools ? { tools: req.tools } : {}),
    ...(req.tool_choice ? { tool_choice: req.tool_choice } : {}),
    ...(req.response_format ? { response_format: req.response_format } : {}),
    ...(req.provider !== undefined ? { provider: req.provider } : {}),
  };
}

/**
 * Transforms ChatCompletionRequestDTO to normalized ProviderRequest
 */
export function mapDTOToProviderRequest(dto: ChatCompletionRequestDTO): ProviderRequest {
  return {
    model: dto.model,
    messages: dto.messages as ChatMessage[],
    ...(dto.temperature !== undefined ? { temperature: dto.temperature } : {}),
    ...(dto.top_p !== undefined ? { top_p: dto.top_p } : {}),
    ...(dto.max_tokens !== undefined ? { max_tokens: dto.max_tokens } : {}),
    stream: Boolean(dto.stream),
    ...(dto.stop !== undefined ? { stop: dto.stop } : {}),
    ...(dto.presence_penalty !== undefined ? { presence_penalty: dto.presence_penalty } : {}),
    ...(dto.frequency_penalty !== undefined ? { frequency_penalty: dto.frequency_penalty } : {}),
    ...(dto.user !== undefined ? { user: dto.user } : {}),
    ...(dto.tools ? { tools: dto.tools as ProviderRequest['tools'] } : {}),
    ...(dto.tool_choice ? { tool_choice: dto.tool_choice } : {}),
    ...(dto.response_format ? { response_format: dto.response_format } : {}),
  };
}

/**
 * Transforms normalized ProviderStreamChunk to OpenAI-compatible ChatCompletionChunkDTO
 */
export function mapProviderStreamChunkToDTO(chunk: ProviderStreamChunk): ChatCompletionChunkDTO {
  return {
    id: chunk.id,
    object: 'chat.completion.chunk',
    created: chunk.created,
    model: chunk.model,
    choices: chunk.choices.map((c) => ({
      index: c.index,
      delta: {
        ...(c.delta.role ? { role: c.delta.role } : {}),
        ...(c.delta.content !== undefined ? { content: c.delta.content } : {}),
      },
      finish_reason: c.finish_reason,
    })),
    ...(chunk.usage
      ? {
          usage: {
            prompt_tokens: chunk.usage.promptTokens,
            completion_tokens: chunk.usage.completionTokens,
            total_tokens: chunk.usage.totalTokens,
          },
        }
      : {}),
  };
}
