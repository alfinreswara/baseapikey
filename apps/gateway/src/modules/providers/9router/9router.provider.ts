import type {
  IProviderAdapter,
  ProviderBinaryResponse,
  ProviderCapabilities,
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
} from '@baseapikey/shared';
import { ProviderError } from '@baseapikey/shared';

import type { NineRouterConfig } from './9router.config';
import { DEFAULT_NINE_ROUTER_BASE_URL, DEFAULT_NINE_ROUTER_TIMEOUT_MS } from './9router.config';
import { mapNineRouterError } from './9router.error-mapper';
import {
  mapFromNineRouterModel,
  mapFromNineRouterResponse,
  mapFromNineRouterStreamChunk,
  mapToNineRouterRequest,
} from './9router.mappers';
import type {
  NineRouterWireModelList,
  NineRouterWireResponse,
  NineRouterWireStreamChunk,
} from './9router.types';

/**
 * Concrete 9Router AI Provider Adapter implementing IProviderAdapter.
 */
export class NineRouterProvider implements IProviderAdapter {
  public static readonly PROVIDER_SLUG = '9router';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly providerSlug: string;
  private readonly capabilities: ProviderCapabilities;

  constructor(config: NineRouterConfig) {
    if (!config || typeof config.apiKey !== 'string' || !config.apiKey.trim()) {
      throw new ProviderError({
        code: 'MISSING_PROVIDER_API_KEY',
        message: '9Router initialization failed: NINEROUTER_API_KEY configuration is required',
        statusCode: 500,
        category: 'AUTHENTICATION_ERROR',
        isRetryable: false,
        providerSlug: NineRouterProvider.PROVIDER_SLUG,
      });
    }

    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_NINE_ROUTER_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_NINE_ROUTER_TIMEOUT_MS;
    this.providerSlug = config.providerSlug?.trim() || NineRouterProvider.PROVIDER_SLUG;
    this.capabilities = {
      supportsChat: true,
      supportsStreaming: true,
      supportsModels: true,
      supportsTools: true,
      supportsVision: true,
      supportsEmbeddings: true,
      supportsImages: true,
      supportsAudio: true,
      ...config.capabilities,
    };
  }

  getName(): string {
    return this.providerSlug;
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  async chat(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResponse> {
    const wireBody = mapToNineRouterRequest(request, false);
    const { controller, cleanup } = this.createTimeoutController(options?.signal);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(wireBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          errorData = await response.text();
        }
        throw mapNineRouterError(errorData, response.status, this.getName());
      }

      const json = (await response.json()) as NineRouterWireResponse;

      if (!json || typeof json !== 'object' || !Array.isArray(json.choices)) {
        throw new ProviderError({
          code: 'MALFORMED_PROVIDER_RESPONSE',
          message: '9Router returned malformed non-array choices payload',
          statusCode: 502,
          category: 'SERVER_ERROR',
          isRetryable: true,
          providerSlug: this.getName(),
        });
      }

      return mapFromNineRouterResponse(json, this.getName());
    } catch (err: unknown) {
      throw mapNineRouterError(err, undefined, this.getName());
    } finally {
      cleanup();
    }
  }

  async streamChat(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<AsyncIterable<ProviderStreamChunk>> {
    const wireBody = mapToNineRouterRequest(request, true);
    const { controller, cleanup } = this.createTimeoutController(options?.signal);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(wireBody),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      cleanup();
      throw mapNineRouterError(err, undefined, this.getName());
    }

    if (!response.ok) {
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = await response.text();
      }
      cleanup();
      throw mapNineRouterError(errorData, response.status, this.getName());
    }

    if (!response.body) {
      cleanup();
      throw new ProviderError({
        code: 'MALFORMED_PROVIDER_RESPONSE',
        message: '9Router streaming response missing response body',
        statusCode: 502,
        category: 'SERVER_ERROR',
        isRetryable: true,
        providerSlug: this.getName(),
      });
    }

    const providerSlug = this.getName();
    const reader = response.body.getReader();

    return (async function* () {
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      try {
        while (true) {
          if (options?.signal?.aborted) {
            void reader.cancel();
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;

            if (trimmed === 'data: [DONE]') {
              return;
            }

            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const wireChunk = JSON.parse(jsonStr) as NineRouterWireStreamChunk;
                if (wireChunk && Array.isArray(wireChunk.choices)) {
                  yield mapFromNineRouterStreamChunk(wireChunk, providerSlug);
                }
              } catch {
                // Ignore chunk parse errors in stream
              }
            }
          }
        }
      } catch (err: unknown) {
        throw mapNineRouterError(err, undefined, providerSlug);
      } finally {
        cleanup();
        void reader.cancel();
      }
    })();
  }

  async chatCompletion(
    request: ProviderRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResponse | AsyncIterable<ProviderStreamChunk>> {
    if (request.stream === true) {
      return this.streamChat(request, options);
    }
    return this.chat(request, options);
  }

  async listModels(options?: ProviderRequestOptions): Promise<ProviderModel[]> {
    const { controller, cleanup } = this.createTimeoutController(options?.signal);

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          errorData = await response.text();
        }
        throw mapNineRouterError(errorData, response.status, this.getName());
      }

      const json = (await response.json()) as NineRouterWireModelList;
      const data = json.data ?? [];
      return data.map((m) => mapFromNineRouterModel(m, this.getName()));
    } catch (err: unknown) {
      throw mapNineRouterError(err, undefined, this.getName());
    } finally {
      cleanup();
    }
  }

  async healthCheck(options?: ProviderRequestOptions): Promise<ProviderHealthStatus> {
    try {
      await this.listModels(options);
      return {
        status: 'healthy',
        provider: this.getName(),
        checkedAt: new Date(),
      };
    } catch (err: unknown) {
      const mapped = mapNineRouterError(err, undefined, this.getName());
      return {
        status: mapped.category === 'AUTHENTICATION_ERROR' ? 'degraded' : 'down',
        provider: this.getName(),
        checkedAt: new Date(),
        message: mapped.message,
      };
    }
  }

  async createEmbedding(
    request: ProviderEmbeddingRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderEmbeddingResponse> {
    return this.postJson<ProviderEmbeddingResponse>('/embeddings', request, options);
  }

  async createImage(
    request: ProviderImageRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderImageResponse> {
    return this.postJson<ProviderImageResponse>('/images/generations', request, options);
  }

  async createSpeech(
    request: ProviderSpeechRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderBinaryResponse> {
    const { controller, cleanup } = this.createTimeoutController(options?.signal);
    try {
      const response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) throw await this.responseError(response);
      return {
        data: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      };
    } catch (error) {
      throw mapNineRouterError(error, undefined, this.getName());
    } finally {
      cleanup();
    }
  }

  async transcribeAudio(
    request: ProviderTranscriptionRequest,
    options?: ProviderRequestOptions,
  ): Promise<ProviderTranscriptionResponse> {
    const { controller, cleanup } = this.createTimeoutController(options?.signal);
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([Buffer.from(request.file)], { type: request.contentType }),
        request.filename,
      );
      form.append('model', request.model);
      if (request.language) form.append('language', request.language);
      if (request.prompt) form.append('prompt', request.prompt);
      if (request.response_format) form.append('response_format', request.response_format);
      if (request.temperature !== undefined)
        form.append('temperature', String(request.temperature));
      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) throw await this.responseError(response);
      const contentType = response.headers.get('content-type') ?? '';
      return contentType.includes('application/json')
        ? ((await response.json()) as Record<string, unknown>)
        : await response.text();
    } catch (error) {
      throw mapNineRouterError(error, undefined, this.getName());
    } finally {
      cleanup();
    }
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    options?: ProviderRequestOptions,
  ): Promise<T> {
    const { controller, cleanup } = this.createTimeoutController(options?.signal);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw await this.responseError(response);
      return (await response.json()) as T;
    } catch (error) {
      throw mapNineRouterError(error, undefined, this.getName());
    } finally {
      cleanup();
    }
  }

  private async responseError(response: Response): Promise<ProviderError> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = await response.text();
    }
    return mapNineRouterError(payload, response.status, this.getName());
  }

  private createTimeoutController(externalSignal?: AbortSignal): {
    controller: AbortController;
    cleanup: () => void;
  } {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      controller.abort(new Error('9Router request timed out'));
    }, this.timeoutMs);

    const onExternalAbort = (): void => {
      controller.abort(externalSignal?.reason ?? new Error('Aborted'));
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        onExternalAbort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort);
      }
    }

    const cleanup = (): void => {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    };

    return { controller, cleanup };
  }
}
