import type { PrototypeAnalysisResult } from "@tibao/video-core";

export interface PrototypeAnalysisInput {
  projectId: string;
  projectName: string;
  targetMarket: string;
  language: string;
  targetDurationSec: number | null;
  similarityScore: number;
  sourceAssetId: string;
  productAssetIds: string[];
  catalogTitle?: string;
  catalogCategory?: string;
  catalogBrand?: string;
}

export interface PrototypeAnalysisProvider {
  readonly id: string;
  readonly model: string;
  analyze(input: PrototypeAnalysisInput, signal: AbortSignal): Promise<PrototypeAnalysisResult>;
}

export interface ProviderRunMetadata {
  provider: string;
  model: string;
  durationMs: number;
  inputHash: string;
  outputHash: string;
}
