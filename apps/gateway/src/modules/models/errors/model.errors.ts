import { AppError } from '@baseapikey/shared';

/**
 * The requested model is not part of the catalogue. The request is rejected
 * before it reaches a provider, an unknown model is never metered as a free
 * model.
 */
export class ModelNotAvailableError extends AppError {
  constructor(modelId: string, category?: string) {
    super('MODEL_NOT_AVAILABLE', `Model "${modelId}" is not available`, 400, {
      modelId,
      ...(category ? { category } : {}),
    });
  }
}

/**
 * The model is in the catalogue but it carries no trusted price. The request
 * is rejected, the price of a model is always taken from the server side
 * configuration.
 */
export class ModelPricingNotConfiguredError extends AppError {
  constructor(modelId: string) {
    super(
      'MODEL_PRICING_NOT_CONFIGURED',
      `Model "${modelId}" has no configured price and is not marked as free`,
      400,
      { modelId },
    );
  }
}

/**
 * The client asked for a provider that does not serve the requested model.
 * The routing and the billing follow the mapping of the catalogue.
 */
export class ModelProviderMismatchError extends AppError {
  constructor(modelId: string, requestedProvider: string, expectedProvider: string) {
    super(
      'MODEL_PROVIDER_MISMATCH',
      `Model "${modelId}" is served by provider "${expectedProvider}", not by "${requestedProvider}"`,
      400,
      { modelId, requestedProvider, expectedProvider },
    );
  }
}

/**
 * The model exists but does not serve the category of the endpoint.
 */
export class ModelCategoryMismatchError extends AppError {
  constructor(modelId: string, expectedCategory: string, actualCategory: string) {
    super(
      'MODEL_CATEGORY_MISMATCH',
      `Model "${modelId}" is a ${actualCategory} model and cannot be used for a ${expectedCategory} request`,
      400,
      { modelId, expectedCategory, actualCategory },
    );
  }
}

/**
 * The model catalogue is not available, so no model can be priced. The
 * request is rejected instead of being served without a price.
 */
export class ModelCatalogUnavailableError extends AppError {
  constructor(detail?: string) {
    super(
      'MODEL_CATALOG_UNAVAILABLE',
      'The model catalogue is not available, the request can not be priced',
      503,
      detail ? { detail } : undefined,
    );
  }
}
