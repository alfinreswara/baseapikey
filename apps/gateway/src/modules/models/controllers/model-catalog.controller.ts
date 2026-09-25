import { ValidationError } from '@baseapikey/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ModelCatalogResponseDto } from '../dto/model-catalog.dto';
import { ModelCatalogQuerySchema } from '../dto/model-catalog.dto';
import type { ModelCatalogService } from '../services/model-catalog.service';

export class ModelCatalogController {
  constructor(private readonly modelCatalogService: ModelCatalogService) {}

  async listModels(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const parsed = ModelCatalogQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ValidationError('Invalid model catalog query');
    const data = await this.modelCatalogService.listModels(parsed.data);
    const response: ModelCatalogResponseDto = { object: 'list', data };

    void reply
      .header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
      .send(response);
  }

  async getModel(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const id = (request.params as { id?: string }).id;
    if (!id) throw new ValidationError('Model id is required');
    const data = await this.modelCatalogService.getModel(decodeURIComponent(id));
    void reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300').send(data);
  }
}
