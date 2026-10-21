import type { ModelCatalogItemDto } from '../dto/model-catalog.dto';
import {
  ModelCatalogUnavailableError,
  ModelCategoryMismatchError,
  ModelNotAvailableError,
  ModelPricingNotConfiguredError,
  ModelProviderMismatchError,
} from '../errors/model.errors';

import type { ModelCatalogService } from './model-catalog.service';

export type ModelCategory = ModelCatalogItemDto['category'];

/**
 * The trusted description of a model: the catalogue decides which provider
 * serves it and what it costs. A client never supplies a price.
 */
export interface ModelPolicy {
  /** The canonical identifier of the model in the catalogue. */
  modelId: string;
  /** The provider that serves the model. */
  providerSlug: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  maxOutputTokens: number;
  category: ModelCategory;
  /** The model is explicitly configured as free by an administrator. */
  isFree: boolean;
}

/**
 * The cost of a request in US dollars. The price comes from the catalogue,
 * the token counts come from the provider response.
 */
export function estimateModelCostUsd(
  policy: ModelPolicy,
  promptTokens: number,
  completionTokens: number,
): number {
  if (policy.isFree) return 0;
  const inputCost = (promptTokens * policy.inputPricePerMillion) / 1_000_000;
  const outputCost = (completionTokens * policy.outputPricePerMillion) / 1_000_000;
  return Number((inputCost + outputCost).toFixed(8));
}

export interface ModelPolicyResolver {
  resolve(modelId: string, requestedProvider?: string | undefined): Promise<ModelPolicy>;
  assertCategory(policy: ModelPolicy, expectedCategory: ModelCategory): void;
}

/**
 * Resolves the policy of a model before the request is forwarded to a
 * provider.
 *
 * The rules are fail closed:
 *
 * - a model that is not in the catalogue is rejected,
 * - a model without a price is rejected unless an administrator marked it as
 *   free,
 * - the provider of the request has to be the provider of the catalogue
 *   entry, a client cannot route around the mapping.
 */
export class ModelPolicyService implements ModelPolicyResolver {
  constructor(private readonly catalog: ModelCatalogService) {}

  async resolve(modelId: string, requestedProvider?: string | undefined): Promise<ModelPolicy> {
    const normalized = modelId.trim();
    if (!normalized) {
      throw new ModelNotAvailableError(modelId);
    }

    const entry = await this.findEntry(normalized);
    if (!entry) {
      throw new ModelNotAvailableError(normalized);
    }

    const inputPricePerMillion = entry.pricing.input;
    const outputPricePerMillion = entry.pricing.output;
    const isFree = entry.is_free;

    if (!isFree && inputPricePerMillion <= 0 && outputPricePerMillion <= 0) {
      throw new ModelPricingNotConfiguredError(entry.id);
    }

    const expectedProvider = entry.provider.slug;
    if (requestedProvider && requestedProvider !== expectedProvider) {
      throw new ModelProviderMismatchError(entry.id, requestedProvider, expectedProvider);
    }

    return {
      modelId: entry.id,
      providerSlug: expectedProvider,
      inputPricePerMillion,
      outputPricePerMillion,
      maxOutputTokens: entry.max_output_tokens,
      category: entry.category,
      isFree,
    };
  }

  /**
   * Checks that the model serves the category of the endpoint. The category is
   * part of the catalogue, a client cannot select it.
   */
  assertCategory(policy: ModelPolicy, expectedCategory: ModelCategory): void {
    if (policy.category !== expectedCategory) {
      throw new ModelCategoryMismatchError(policy.modelId, expectedCategory, policy.category);
    }
  }

  private async findEntry(modelId: string): Promise<ModelCatalogItemDto | undefined> {
    const models = await this.catalog.listModels();
    return models.find((model) => model.id === modelId || model.display_name === modelId);
  }
}

/**
 * Used when the model catalogue is not available. Every request is rejected,
 * a model without a trusted price is never served.
 */
export class UnavailableModelPolicyResolver implements ModelPolicyResolver {
  async resolve(): Promise<ModelPolicy> {
    throw new ModelCatalogUnavailableError();
  }

  assertCategory(): void {
    throw new ModelCatalogUnavailableError();
  }
}
