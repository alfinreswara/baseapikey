import type {
  ProviderCapabilities,
  ProviderBinaryResponse,
  ProviderEmbeddingRequest,
  ProviderEmbeddingResponse,
  ProviderHealthStatus,
  ProviderImageRequest,
  ProviderImageResponse,
  ProviderModel,
  ProviderRequest,
  ProviderRequestOptions,
  ProviderResponse,
  ProviderStreamChunk,
  ProviderSpeechRequest,
  ProviderTranscriptionRequest,
  ProviderTranscriptionResponse,
} from './provider.types';

/**
 * Provider Abstraction Interface (IProviderAdapter)
 * Defines the contract that all AI provider adapters (9Router, OpenAI, Anthropic, etc.) must implement.
 */
export interface IProviderAdapter {
  /**
   * Returns the unique provider slug identifier (e.g. '9router', 'openai', 'anthropic')
   */
  getName(): string;

  /**
   * Returns capabilities supported by this provider adapter
   */
  getCapabilities(): ProviderCapabilities;

  /**
   * Executes a non-streaming chat completion
   */
  chat(request: ProviderRequest, options?: ProviderRequestOptions): Promise<ProviderResponse>;

  /**
   * Executes a streaming chat completion emitting normalized async stream chunks
   */
  streamChat(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<AsyncIterable<ProviderStreamChunk>>;

  /**
   * Universal chat completion endpoint supporting both streaming and non-streaming responses
   */
  chatCompletion(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResponse | AsyncIterable<ProviderStreamChunk>>;

  /**
   * Retrieves available model catalog from provider
   */
  listModels(options?: ProviderRequestOptions): Promise<ProviderModel[]>;

  /**
   * Performs provider health check probe
   */
  healthCheck(options?: ProviderRequestOptions): Promise<ProviderHealthStatus>;

  createEmbedding?(
    request: ProviderEmbeddingRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderEmbeddingResponse>;

  createImage?(
    request: ProviderImageRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderImageResponse>;

  createSpeech?(
    request: ProviderSpeechRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderBinaryResponse>;

  transcribeAudio?(
    request: ProviderTranscriptionRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderTranscriptionResponse>;
}
