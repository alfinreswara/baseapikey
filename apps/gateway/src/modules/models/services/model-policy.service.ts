import type { ModelCatalogItemDto } from '../dto/model-catalog.dto';
import {
  ModelCategoryMismatchError,
  ModelNotAvailableError,
  ModelPricingNotConfiguredError,
  ModelProviderMismatchError,
} from '../errors/model.errors';

import type { ModelCatalogService } from './model-catalog.service';

export type ModelCategory = ModelCatalogItemDto['category'];

/**
 * The modality of a request. It decides which price of the catalogue applies.
 */
export type ModelModality = 'chat' | 'embedding' | 'image' | 'speech' | 'transcription';

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
  /** The price of one generated image, in US dollars. */
  pricePerImage: number | null;
  /** The price of one character of synthesized speech, in US dollars. */
  pricePerCharacter: number | null;
  /** The price of one megabyte of transcribed audio, in US dollars. */
  pricePerMegabyte: number | null;
  maxOutputTokens: number;
  category: ModelCategory;
  /** The model is explicitly configured as free by an administrator. */
  isFree: boolean;
}

export interface ModelPolicyResolver {
  resolve(modelId: string, requestedProvider?: string | undefined): Promise<ModelPolicy>;
  assertCategory(policy: ModelPolicy, expectedCategory: ModelCategory): void;
  assertModality(policy: ModelPolicy, modality: ModelModality): void;
}

/**
 * The cost of a request in US dollars and the upper bound that is reserved
 * before the request is forwarded to a provider.
 *
 * The prices come from the catalogue. The token counts of a chat completion
 * and of an embedding come from the provider response. The other modalities are
 * billed with the unit the server can measure: the number of images, the
 * number of characters of the speech input, and the size of the transcribed
 * audio.
 */
export interface ModalityUsage {
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  images?: number | undefined;
  characters?: number | undefined;
  bytes?: number | undefined;
}

const MICROS_PER_USD = 1_000_000;
const BYTES_PER_MEGABYTE = 1_048_576;

function toMicros(usd: number): number {
  return Math.max(0, Math.round(usd * MICROS_PER_USD));
}

/** The cost of a request in US dollars. */
export function estimateModelCostUsd(
  policy: ModelPolicy,
  modality: ModelModality,
  usage: ModalityUsage,
): number {
  if (policy.isFree) return 0;
  switch (modality) {
    case 'chat':
      return roundUsd(
        ((usage.promptTokens ?? 0) * policy.inputPricePerMillion +
          (usage.completionTokens ?? 0) * policy.outputPricePerMillion) /
          1_000_000,
      );
    case 'embedding':
      return roundUsd(((usage.promptTokens ?? 0) * policy.inputPricePerMillion) / 1_000_000);
    case 'image':
      return roundUsd((usage.images ?? 0) * (policy.pricePerImage ?? 0));
    case 'speech':
      return roundUsd((usage.characters ?? 0) * (policy.pricePerCharacter ?? 0));
    case 'transcription':
      return roundUsd(((usage.bytes ?? 0) / BYTES_PER_MEGABYTE) * (policy.pricePerMegabyte ?? 0));
  }
}

/**
 * The upper bound of the cost of a request, in micros. It is the amount that
 * is reserved before the request is forwarded to a provider.
 *
 * The bound of the prompt is the size of the request in bytes, one token can
 * not be shorter than a byte. The bound of the answer is the maximum number of
 * the output tokens of the model.
 */
export function estimateMaxCostMicros(
  policy: ModelPolicy,
  modality: ModelModality,
  usage: ModalityUsage,
): number {
  if (policy.isFree) return 0;
  switch (modality) {
    case 'chat': {
      const promptBound = usage.promptTokens ?? 0;
      const outputBound = Math.min(
        usage.completionTokens ?? policy.maxOutputTokens,
        policy.maxOutputTokens,
      );
      const price = Math.max(policy.inputPricePerMillion, policy.outputPricePerMillion);
      return toMicros(((promptBound + outputBound) * price) / 1_000_000);
    }
    case 'embedding': {
      const promptBound = usage.promptTokens ?? 0;
      return toMicros((promptBound * policy.inputPricePerMillion) / 1_000_000);
    }
    case 'image':
      return toMicros((usage.images ?? 1) * (policy.pricePerImage ?? 0));
    case 'speech':
      return toMicros((usage.characters ?? 0) * (policy.pricePerCharacter ?? 0));
    case 'transcription':
      return toMicros(((usage.bytes ?? 0) / BYTES_PER_MEGABYTE) * (policy.pricePerMegabyte ?? 0));
  }
}

function roundUsd(value: number): number {
  return Number(value.toFixed(8));
}

/**
 * Resolves the policy of a model before the request is forwarded to a
 * provider.
 *
 * The rules are fail closed:
 *
 * - a model that is not in the catalogue is rejected,
 * - a model without a price for the modality of the request is rejected
 *   unless an administrator marked it as free,
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
      pricePerImage: entry.price_per_image,
      pricePerCharacter: entry.price_per_character,
      pricePerMegabyte: entry.price_per_megabyte,
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

  /**
   * Checks that the model has a verifiable price for the modality of the
   * request. A model without a price for its modality is rejected, it is
   * never served for free.
   */
  assertModality(policy: ModelPolicy, modality: ModelModality): void {
    if (policy.isFree) return;
    const priced =
      modality === 'chat' || modality === 'embedding'
        ? policy.inputPricePerMillion > 0 || policy.outputPricePerMillion > 0
        : modality === 'image'
          ? (policy.pricePerImage ?? 0) > 0
          : modality === 'speech'
            ? (policy.pricePerCharacter ?? 0) > 0
            : (policy.pricePerMegabyte ?? 0) > 0;
    if (!priced) {
      throw new ModelPricingNotConfiguredError(policy.modelId);
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
    throw new ModelNotAvailableError('the model catalogue is not available');
  }

  assertCategory(): void {
    throw new ModelNotAvailableError('the model catalogue is not available');
  }

  assertModality(): void {
    throw new ModelNotAvailableError('the model catalogue is not available');
  }
}
