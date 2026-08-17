import type { PrototypeAnalysisProvider, StoryboardImageProvider } from "./contracts.js";

export class ProviderRegistry {
  constructor(
    private readonly prototypeAnalysisProvider: PrototypeAnalysisProvider,
    private readonly storyboardImageProvider: StoryboardImageProvider,
  ) {}

  prototypeAnalysis(): PrototypeAnalysisProvider {
    return this.prototypeAnalysisProvider;
  }

  storyboardImage(): StoryboardImageProvider {
    return this.storyboardImageProvider;
  }
}
