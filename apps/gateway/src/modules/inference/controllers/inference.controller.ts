import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  EmbeddingSchema,
  ImageGenerationSchema,
  parseInferenceDto,
  SpeechSchema,
  TranscriptionFieldsSchema,
} from '../dto/inference.dto';
import type { InferenceService } from '../services/inference.service';
import { parseAudioMultipart } from '../utils/multipart.util';

export class InferenceController {
  constructor(private readonly service: InferenceService) {}

  async embedding(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const dto = parseInferenceDto(EmbeddingSchema, request.body);
    request.usageMetadata = { provider: dto.provider ?? '9router', model: dto.model };
    const result = await this.withAbort(reply, (signal) =>
      this.service.createEmbedding(dto, { signal }),
    );
    request.usageMetadata = {
      ...request.usageMetadata,
      promptTokens: result.usage.prompt_tokens,
      totalTokens: result.usage.total_tokens,
    };
    void reply.status(200).send(result);
  }

  async image(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const dto = parseInferenceDto(ImageGenerationSchema, request.body);
    request.usageMetadata = {
      provider: dto.provider ?? '9router',
      model: dto.model ?? 'default-image-model',
    };
    const result = await this.withAbort(reply, (signal) =>
      this.service.createImage(dto, { signal }),
    );
    void reply.status(200).send(result);
  }

  async speech(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const dto = parseInferenceDto(SpeechSchema, request.body);
    request.usageMetadata = { provider: dto.provider ?? '9router', model: dto.model };
    const result = await this.withAbort(reply, (signal) =>
      this.service.createSpeech(dto, { signal }),
    );
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
    request.usageMetadata = { provider: fields.provider ?? '9router', model: fields.model };
    const result = await this.withAbort(reply, (signal) =>
      this.service.transcribeAudio(fields, multipart.file, { signal }),
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
    try {
      return await operation(controller.signal);
    } finally {
      reply.raw.removeListener('close', onClose);
    }
  }
}
