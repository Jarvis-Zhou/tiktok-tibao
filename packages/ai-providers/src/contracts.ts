import type { AdaptedBlueprint, ProductProfile, PrototypeAnalysisResult, SourceVideoAnalysis } from "@tibao/video-core";

export type ProviderFailureKind = "transient" | "rate_limited" | "invalid_output" | "policy" | "permanent";

export interface ProviderContext {
  projectId: string;
  jobId: string;
  idempotencyKey: string;
  signal: AbortSignal;
}

export interface ProviderResult<T> {
  value: T;
  provider: string;
  model: string;
  providerRequestId: string | null;
  usage: Record<string, number>;
  estimatedCostMicros: number;
  latencyMs: number;
  safety: Record<string, unknown>;
}

export interface Transcript {
  language: string;
  text: string;
  segments: Array<{ startSec: number; endSec: number; text: string }>;
}

export interface FrameBundle {
  sourceAssetId: string;
  durationSec: number;
  framePaths: string[];
  contactSheetPath: string | null;
}

export interface VisualAnalysis {
  shots: Array<Record<string, unknown>>;
  observations: Array<Record<string, unknown>>;
}

export interface TranscriptionProvider {
  readonly id: string;
  readonly model: string;
  transcribe(input: { audioPath: string; language: string }, context: ProviderContext): Promise<ProviderResult<Transcript>>;
}

export interface VisionAnalysisProvider {
  readonly id: string;
  readonly model: string;
  analyzeVideo(input: FrameBundle, context: ProviderContext): Promise<ProviderResult<VisualAnalysis>>;
  analyzeProduct(input: { imagePaths: string[]; assetIds: string[] }, context: ProviderContext): Promise<ProviderResult<ProductProfile>>;
}

export interface TextGenerationProvider {
  readonly id: string;
  readonly model: string;
  buildSourceBlueprint(input: { visual: VisualAnalysis; transcript: Transcript | null }, context: ProviderContext): Promise<ProviderResult<SourceVideoAnalysis>>;
  adaptBlueprint(input: { source: SourceVideoAnalysis; product: ProductProfile; market: string; language: string }, context: ProviderContext): Promise<ProviderResult<AdaptedBlueprint>>;
  buildScenePrompts(input: { scene: Record<string, unknown> }, context: ProviderContext): Promise<ProviderResult<Record<string, string>>>;
}

export interface PrototypeAnalysisInput {
  projectId: string;
  projectName: string;
  targetMarket: string;
  language: string;
  targetDurationSec: number | null;
  similarityScore: number;
  sourceAssetId: string;
  productAssetIds: string[];
  sourceDurationSec?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  audioAvailable?: boolean;
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

export interface StoryboardImageInput {
  projectId: string;
  sceneId: string;
  generation: number;
  imagePrompt: string;
  negativePrompt: string;
  width?: number;
  height?: number;
}

export interface GeneratedStoryboardImage {
  mimeType: "image/png";
  bytes: Buffer;
  width: number;
  height: number;
  qc: {
    status: "passed" | "needs_review";
    productPresence: number;
    visualConsistency: number;
    textAnomaly: number;
  };
}

export interface StoryboardImageProvider {
  readonly id: string;
  readonly model: string;
  generate(input: StoryboardImageInput, signal: AbortSignal): Promise<GeneratedStoryboardImage>;
}
