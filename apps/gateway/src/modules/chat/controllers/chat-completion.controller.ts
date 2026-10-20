import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ChatCompletionChunkDTO } from '../dto/chat-completion.dto';
import { validateChatCompletionRequest } from '../dto/chat-completion.dto';
import type { ChatCompletionService } from '../services/chat-completion.service';

export function createChatCompletionController(chatService: ChatCompletionService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const dto = validateChatCompletionRequest(request.body);

    request.usageMetadata = {
      provider: dto.provider ?? '9router',
      model: dto.model,
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

    const options = { signal: abortController.signal };

    if (!dto.stream) {
      try {
        const responseDTO = await chatService.createCompletion(dto, options);
        if (responseDTO.usage) {
          request.usageMetadata = {
            ...request.usageMetadata,
            promptTokens: responseDTO.usage.prompt_tokens,
            completionTokens: responseDTO.usage.completion_tokens,
            totalTokens: responseDTO.usage.total_tokens,
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
  };
}
