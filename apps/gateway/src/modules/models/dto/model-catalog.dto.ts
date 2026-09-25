import { z } from 'zod';

export const ModelCatalogItemSchema = z.object({
  id: z.string().min(1),
  object: z.literal('model'),
  created: z.number().int().nonnegative(),
  owned_by: z.string().min(1),
  display_name: z.string().min(1),
  category: z.enum(['CHAT', 'EMBEDDING', 'IMAGE', 'AUDIO', 'VISION']),
  context_window: z.number().int().positive(),
  max_output_tokens: z.number().int().positive(),
  pricing: z.object({
    currency: z.literal('USD'),
    unit: z.literal('million_tokens'),
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
  }),
  capabilities: z.object({
    streaming: z.boolean(),
    vision: z.boolean(),
    function_calling: z.boolean(),
    json_mode: z.boolean(),
    reasoning: z.boolean(),
  }),
  provider: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
  }),
});

export const ModelCatalogSchema = z.array(ModelCatalogItemSchema);

export type ModelCatalogItemDto = z.infer<typeof ModelCatalogItemSchema>;

export interface ModelCatalogResponseDto {
  object: 'list';
  data: ModelCatalogItemDto[];
}

export const ModelCatalogQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(['CHAT', 'EMBEDDING', 'IMAGE', 'AUDIO', 'VISION']).optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['name', 'price_input', 'price_output', 'context']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export type ModelCatalogQueryDto = z.infer<typeof ModelCatalogQuerySchema>;
