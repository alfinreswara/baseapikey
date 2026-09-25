/**
 * Normalized Chat Message Role type
 */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool' | 'developer';

/**
 * Tool call structure in chat message
 */
export interface ChatMessageToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Text content part in multimodal messages
 */
export interface ChatMessageContentPartText {
  type: 'text';
  text: string;
}

/**
 * Image content part in multimodal messages
 */
export interface ChatMessageContentPartImage {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high' | undefined;
  };
}

export type ChatMessageContentPart = ChatMessageContentPartText | ChatMessageContentPartImage;

export type ChatMessageContent = string | ChatMessageContentPart[];

/**
 * Normalized Chat Message
 */
export interface ChatMessage {
  role: ChatRole;
  content: ChatMessageContent;
  name?: string | undefined;
  tool_calls?: ChatMessageToolCall[] | undefined;
  tool_call_id?: string | undefined;
}

/**
 * Tool definition for function calling
 */
export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string | undefined;
    parameters?: Record<string, unknown> | undefined;
  };
}

/**
 * Normalized internal Chat Request (ProviderRequest / UnifiedChatRequest)
 */
export interface ProviderRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number | undefined;
  top_p?: number | undefined;
  n?: number | undefined;
  stream?: boolean | undefined;
  stop?: string | string[] | undefined;
  max_tokens?: number | undefined;
  presence_penalty?: number | undefined;
  frequency_penalty?: number | undefined;
  user?: string | undefined;
  tools?: ChatTool[] | undefined;
  tool_choice?: unknown | undefined;
  response_format?: { type: 'text' | 'json_object' } | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type UnifiedChatRequest = ProviderRequest;

/**
 * Token usage summary
 */
export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Normalized Choice in non-streaming response
 */
export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

/**
 * Normalized Non-Streaming Response (ProviderResponse / ChatResponse)
 */
export interface ProviderResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  provider: string;
  choices: ChatChoice[];
  usage?: ChatUsage | undefined;
}

export type ChatResponse = ProviderResponse;

/**
 * Delta content in streaming SSE chunk
 */
export interface StreamDelta {
  role?: ChatRole | undefined;
  content?: string | null | undefined;
  tool_calls?: Partial<ChatMessageToolCall>[] | undefined;
}

/**
 * Choice in streaming SSE chunk
 */
export interface StreamChoice {
  index: number;
  delta: StreamDelta;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

/**
 * Normalized Stream Chunk (ProviderStreamChunk / StreamChunk)
 */
export interface ProviderStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  provider: string;
  choices: StreamChoice[];
  usage?: ChatUsage | undefined;
}

export type StreamChunk = ProviderStreamChunk;

/**
 * Normalized Provider Model representation
 */
export interface ProviderModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  provider: string;
  context_length?: number | undefined;
  capabilities?: ProviderCapabilities | undefined;
}

/**
 * Provider capabilities flag object
 */
export interface ProviderCapabilities {
  supportsChat: boolean;
  supportsStreaming: boolean;
  supportsModels: boolean;
  supportsTools?: boolean | undefined;
  supportsVision?: boolean | undefined;
  supportsEmbeddings?: boolean | undefined;
  supportsImages?: boolean | undefined;
  supportsAudio?: boolean | undefined;
}

export interface ProviderEmbeddingRequest {
  model: string;
  input: string | string[] | number[] | number[][];
  encoding_format?: 'float' | 'base64' | undefined;
  dimensions?: number | undefined;
  user?: string | undefined;
}

export interface ProviderEmbeddingResponse {
  object: 'list';
  data: Array<{ object: 'embedding'; embedding: number[] | string; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

export interface ProviderImageRequest {
  model?: string | undefined;
  prompt: string;
  n?: number | undefined;
  quality?: 'standard' | 'hd' | 'low' | 'medium' | 'high' | undefined;
  response_format?: 'url' | 'b64_json' | undefined;
  size?: string | undefined;
  style?: 'vivid' | 'natural' | undefined;
  user?: string | undefined;
}

export interface ProviderImageResponse {
  created: number;
  data: Array<{
    url?: string | undefined;
    b64_json?: string | undefined;
    revised_prompt?: string | undefined;
  }>;
}

export interface ProviderSpeechRequest {
  model: string;
  input: string;
  voice: string;
  response_format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm' | undefined;
  speed?: number | undefined;
}

export interface ProviderTranscriptionRequest {
  file: Uint8Array;
  filename: string;
  contentType: string;
  model: string;
  language?: string | undefined;
  prompt?: string | undefined;
  response_format?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt' | undefined;
  temperature?: number | undefined;
}

export interface ProviderBinaryResponse {
  data: Uint8Array;
  contentType: string;
}

export type ProviderTranscriptionResponse = Record<string, unknown> | string;

/**
 * Provider health status discriminated state
 */
export type ProviderHealthState = 'healthy' | 'degraded' | 'down';

export interface ProviderHealthStatus {
  status: ProviderHealthState;
  provider: string;
  latencyMs?: number | undefined;
  message?: string | undefined;
  checkedAt: Date;
}

export type HealthStatus = ProviderHealthStatus;

/**
 * Request execution options (cancellation, timeout, custom headers)
 */
export interface ProviderRequestOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number | undefined;
  headers?: Record<string, string> | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}
