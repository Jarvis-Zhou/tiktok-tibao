import type { PrototypeAnalysisProvider } from "./contracts.js";

export class ProviderRegistry {
  constructor(private readonly prototypeAnalysisProvider: PrototypeAnalysisProvider) {}

  prototypeAnalysis(): PrototypeAnalysisProvider {
    return this.prototypeAnalysisProvider;
  }
}
