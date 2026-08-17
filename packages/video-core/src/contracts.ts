export const VIDEO_PROJECT_STATUSES = [
  "draft",
  "needs_video_upload",
  "ready_for_analysis",
  "analyzing",
  "analysis_ready",
  "analysis_failed",
  "adapting",
  "adaptation_ready",
  "adaptation_failed",
  "generating_storyboard",
  "storyboard_ready",
  "partially_generated",
  "storyboard_failed",
  "exporting",
  "exported",
] as const;

export type VideoProjectStatus = (typeof VIDEO_PROJECT_STATUSES)[number];

export const VIDEO_JOB_STATUSES = [
  "queued",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "cancelled",
  "superseded",
] as const;

export type VideoJobStatus = (typeof VIDEO_JOB_STATUSES)[number];
import type {
  AdaptedBlueprint,
  ProductProfile,
  SourceVideoAnalysis,
  StoryboardGenerationStatus,
  StoryboardQcStatus,
} from "./artifacts.js";

export type VideoJobType = "prototype_analysis" | "scene_storyboard" | "prompt_package_export";
export type VideoJobCategory = "media" | "text" | "image";
export type VideoAssetRole = "source_video" | "product_image" | "custom_storyboard";
export type VideoAssetStatus = "pending" | "uploading" | "uploaded" | "ready" | "rejected";

export interface CatalogContext {
  shop_id?: string;
  product_id?: string;
  title?: string;
  category?: string;
  brand?: string;
  shop_region?: string;
}

export interface VideoProject {
  id: string;
  owner_id: string;
  name: string;
  status: VideoProjectStatus;
  current_step: string;
  target_market: string;
  language: string;
  target_duration_sec: number | null;
  similarity_score: number;
  revision: number;
  catalog_context: CatalogContext | null;
  created_at: string;
  updated_at: string;
}

export interface VideoAsset {
  id: string;
  project_id: string;
  role: VideoAssetRole;
  status: VideoAssetStatus;
  mime_type: string;
  bytes: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  metadata: Record<string, unknown>;
  sort_order: number;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface PrototypeScene {
  id: string;
  position: number;
  generation_status: StoryboardGenerationStatus;
  revision: number;
  generation: number;
  locked_revision_id: string | null;
  current_revision_id: string | null;
  stale_reason: string | null;
  qc_status: StoryboardQcStatus;
  storyboard_asset_id: string | null;
  short: string;
  label: string;
  title: string;
  description: string;
  duration_sec: number;
  headline: string;
  accent: string;
  overlay: string;
  caption: string;
  script: string;
  prompt: string;
}

export interface PrototypeAnalysisResult {
  schema_version: "prototype-analysis-v1";
  summary: {
    title: string;
    duration_sec: number;
    scene_count: number;
    confidence: number;
  };
  source_blueprint: SourceVideoAnalysis;
  product_profile: ProductProfile;
  adapted_blueprint: AdaptedBlueprint;
  scenes: PrototypeScene[];
}

export interface VideoJob {
  id: string;
  project_id: string;
  type: VideoJobType;
  category: VideoJobCategory;
  status: VideoJobStatus;
  attempt: number;
  max_attempts: number;
  progress_stage: string | null;
  error_code: string | null;
  error_message: string | null;
  error_retryable: boolean | null;
  input_fingerprint: string;
  input_revision_map: Record<string, unknown>;
  target_generation: number;
  retry_of_job_id: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

export interface VideoApiErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    next_action?: string;
    details?: Record<string, unknown>;
  };
  request_id?: string;
}

export class VideoDomainError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly nextAction: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(input: {
    code: string;
    message: string;
    statusCode?: number;
    retryable?: boolean;
    nextAction?: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "VideoDomainError";
    this.code = input.code;
    this.statusCode = input.statusCode ?? 422;
    this.retryable = input.retryable ?? false;
    this.nextAction = input.nextAction;
    this.details = input.details;
  }

  toBody(requestId?: string): VideoApiErrorBody {
    const error: VideoApiErrorBody["error"] = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.nextAction !== undefined) error.next_action = this.nextAction;
    if (this.details !== undefined) error.details = this.details;
    return requestId === undefined ? { error } : { error, request_id: requestId };
  }
}
