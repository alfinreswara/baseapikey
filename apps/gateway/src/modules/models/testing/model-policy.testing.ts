import { ModelCategoryMismatchError, ModelProviderMismatchError } from '../errors/model.errors';
import type {
  ModelCategory,
  ModelPolicy,
  ModelPolicyResolver,
} from '../services/model-policy.service';

export interface TestModelPolicyOptions {
  providerSlug?: string;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  isFree?: boolean;
  pricePerImage?: number | null;
  pricePerCharacter?: number | null;
  pricePerMegabyte?: number | null;
  maxOutputTokens?: number;
  category?: ModelCategory;
}

/**
 * A policy resolver for the tests. It resolves every model with a trusted
 * price, so the tests do not need a catalogue.
 */
export class TestModelPolicyResolver implements ModelPolicyResolver {
  constructor(private readonly options: TestModelPolicyOptions = {}) {}

  async resolve(modelId: string, requestedProvider?: string | undefined): Promise<ModelPolicy> {
    const providerSlug = this.options.providerSlug ?? '9router';
    if (requestedProvider && requestedProvider !== providerSlug) {
      throw new ModelProviderMismatchError(modelId, requestedProvider, providerSlug);
    }
    return {
      modelId,
      providerSlug,
      inputPricePerMillion: this.options.inputPricePerMillion ?? 1,
      outputPricePerMillion: this.options.outputPricePerMillion ?? 2,
      pricePerImage: this.options.pricePerImage ?? 0.04,
      pricePerCharacter: this.options.pricePerCharacter ?? 0.000_03,
      pricePerMegabyte: this.options.pricePerMegabyte ?? 0.006,
      maxOutputTokens: this.options.maxOutputTokens ?? 8_192,
      category: this.options.category ?? 'CHAT',
      isFree: this.options.isFree ?? false,
    };
  }

  assertModality(): void {
    // Every modality is priced in the tests.
  }

  assertCategory(policy: ModelPolicy, expectedCategory: ModelCategory): void {
    if (!this.options.category) return;
    if (policy.category !== expectedCategory) {
      throw new ModelCategoryMismatchError(policy.modelId, expectedCategory, policy.category);
    }
  }
}
