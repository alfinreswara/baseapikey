import type {
  IModelCatalogRepository,
  ModelCatalogRecord,
} from '../repositories/model-catalog.repository';

export class MockModelCatalogRepository implements IModelCatalogRepository {
  calls = 0;

  constructor(public models: ModelCatalogRecord[]) {}

  async findActiveModels(): Promise<ModelCatalogRecord[]> {
    this.calls += 1;
    return this.models;
  }
}
