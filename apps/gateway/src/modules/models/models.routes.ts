import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { ModelCatalogController } from './controllers/model-catalog.controller';
import type { ModelCatalogService } from './services/model-catalog.service';

export interface ModelRoutesOptions extends FastifyPluginOptions {
  modelCatalogService: ModelCatalogService;
}

export async function modelRoutes(
  fastify: FastifyInstance,
  options: ModelRoutesOptions,
): Promise<void> {
  const controller = new ModelCatalogController(options.modelCatalogService);

  fastify.get('/v1/models', (request, reply) => controller.listModels(request, reply));
  fastify.get('/v1/models/:id', (request, reply) => controller.getModel(request, reply));
}
