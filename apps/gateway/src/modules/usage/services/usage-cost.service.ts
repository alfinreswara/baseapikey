import { prisma, ProviderStatus } from '@baseapikey/database';

export interface UsageCostInput {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface IUsageCostResolver {
  estimate(input: UsageCostInput): Promise<number>;
}

export function calculateTokenCost(
  promptTokens: number,
  completionTokens: number,
  inputPricePerMillion: number,
  outputPricePerMillion: number,
): number {
  const inputCost = (promptTokens * inputPricePerMillion) / 1_000_000;
  const outputCost = (completionTokens * outputPricePerMillion) / 1_000_000;
  return Number((inputCost + outputCost).toFixed(8));
}

export class PrismaUsageCostResolver implements IUsageCostResolver {
  async estimate(input: UsageCostInput): Promise<number> {
    const model = await prisma.aIModel.findFirst({
      where: {
        isActive: true,
        provider: { status: ProviderStatus.ACTIVE, slug: input.provider },
        OR: [{ slug: input.model }, { name: input.model }],
      },
      select: { inputPricePerMillion: true, outputPricePerMillion: true },
    });
    if (!model) return 0;
    return calculateTokenCost(
      input.promptTokens,
      input.completionTokens,
      model.inputPricePerMillion.toNumber(),
      model.outputPricePerMillion.toNumber(),
    );
  }
}
