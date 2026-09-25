import { ValidationError } from '@baseapikey/shared';
import { z } from 'zod';

export const EmbeddingSchema = z
  .object({
    model: z.string().trim().min(1).max(255),
    input: z.union([
      z.string().max(1_000_000),
      z.array(z.string().max(1_000_000)).min(1).max(2048),
      z.array(z.number().int().nonnegative()).min(1).max(1_000_000),
      z.array(z.array(z.number().int().nonnegative()).min(1)).min(1).max(2048),
    ]),
    encoding_format: z.enum(['float', 'base64']).optional(),
    dimensions: z.number().int().positive().max(100_000).optional(),
    user: z.string().max(255).optional(),
    provider: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const ImageGenerationSchema = z
  .object({
    model: z.string().trim().min(1).max(255).optional(),
    prompt: z.string().trim().min(1).max(32_000),
    n: z.number().int().min(1).max(10).optional(),
    quality: z.enum(['standard', 'hd', 'low', 'medium', 'high']).optional(),
    response_format: z.enum(['url', 'b64_json']).optional(),
    size: z
      .string()
      .regex(/^\d+x\d+$/)
      .max(20)
      .optional(),
    style: z.enum(['vivid', 'natural']).optional(),
    user: z.string().max(255).optional(),
    provider: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const SpeechSchema = z
  .object({
    model: z.string().trim().min(1).max(255),
    input: z.string().min(1).max(4096),
    voice: z.string().trim().min(1).max(100),
    response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
    speed: z.number().min(0.25).max(4).optional(),
    provider: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const TranscriptionFieldsSchema = z
  .object({
    model: z.string().trim().min(1).max(255),
    language: z.string().trim().min(2).max(20).optional(),
    prompt: z.string().max(4096).optional(),
    response_format: z.enum(['json', 'text', 'srt', 'verbose_json', 'vtt']).optional(),
    temperature: z.coerce.number().min(0).max(1).optional(),
    provider: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type EmbeddingDto = z.infer<typeof EmbeddingSchema>;
export type ImageGenerationDto = z.infer<typeof ImageGenerationSchema>;
export type SpeechDto = z.infer<typeof SpeechSchema>;
export type TranscriptionFieldsDto = z.infer<typeof TranscriptionFieldsSchema>;

export function parseInferenceDto<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid inference request', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
