import { prisma, ProviderStatus } from '@baseapikey/database';

export interface ModelCatalogRecord {
  id: string;
  modelId: string;
  displayName: string;
  category: 'CHAT' | 'EMBEDDING' | 'IMAGE' | 'AUDIO' | 'VISION';
  contextWindow: number;
  maxOutputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsJsonMode: boolean;
  supportsReasoning: boolean;
  createdAt: Date;
  provider: {
    id: string;
    name: string;
    slug: string;
  };
}

export interface IModelCatalogRepository {
  findActiveModels(): Promise<ModelCatalogRecord[]>;
}

export class PrismaModelCatalogRepository implements IModelCatalogRepository {
  async findActiveModels(): Promise<ModelCatalogRecord[]> {
    const models = await prisma.aIModel.findMany({
      where: {
        isActive: true,
        provider: { status: ProviderStatus.ACTIVE },
      },
      include: {
        provider: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: [{ provider: { priority: 'asc' } }, { name: 'asc' }],
    });

    return models.map((model) => ({
      id: model.id,
      modelId: model.name,
      displayName: model.displayName,
      category: model.category,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      inputPricePerMillion: model.inputPricePerMillion.toNumber(),
      outputPricePerMillion: model.outputPricePerMillion.toNumber(),
      supportsStreaming: model.supportsStreaming,
      supportsVision: model.supportsVision,
      supportsFunctionCalling: model.supportsFunctionCalling,
      supportsJsonMode: model.supportsJsonMode,
      supportsReasoning: model.supportsReasoning,
      createdAt: model.createdAt,
      provider: model.provider,
    }));
  }
}
