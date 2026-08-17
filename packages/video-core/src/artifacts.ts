export const VIDEO_ARTIFACT_SCHEMA_VERSION = "1.0" as const;

export type VideoArtifactSchemaVersion = typeof VIDEO_ARTIFACT_SCHEMA_VERSION;
export type Confidence = number;

export interface ArtifactEvidence {
  asset_id: string;
  timestamp_sec?: number;
  region?: [number, number, number, number];
  note?: string;
}
export interface SourceHook {
  start_sec: number;
  end_sec: number;
  type: "question" | "contrarian" | "demonstration" | "result_first" | "other";
  description: string;
  evidence: ArtifactEvidence[];
  confidence: Confidence;
}

export interface SourceShot {
  shot_id: string;
  start_sec: number;
  end_sec: number;
  camera_angle: string;
  framing: string;
  subject: string;
  action: string;
  camera_motion: string;
  purpose: string;
  on_screen_text: string;
  speech: string;
  visual_evidence: ArtifactEvidence[];
  confidence: Confidence;
}

export interface SourceVideoAnalysis {
  schema_version: VideoArtifactSchemaVersion;
  source_asset_id: string;
  duration_sec: number;
  aspect_ratio: string;
  video_type: "problem_solution" | "demo" | "before_after" | "listicle" | "testimonial" | "other";
  hook: SourceHook;
  shots: SourceShot[];
  selling_points: Array<{
    text: string;
    evidence: ArtifactEvidence[];
    confidence: Confidence;
  }>;
  pace: "slow" | "medium" | "fast";
  avg_cut_interval_sec: number;
  audio_style: {
    audio_available: boolean;
    rhythm: string;
    mood: string;
    has_voiceover: boolean;
    transcript_status: "available" | "skipped" | "failed";
  };
  subtitle_style: {
    position: "top" | "center" | "bottom" | "mixed" | "other";
    density: "low" | "medium" | "high" | "other";
    description: string;
  };
  cta: {
    type: "shop_now" | "learn_more" | "soft" | "none" | "other";
    start_sec: number;
    end_sec: number;
    expression: string;
  };
  viral_hypotheses: Array<{
    hypothesis: string;
    evidence: ArtifactEvidence[];
    confidence: Confidence;
  }>;
}

export type ProductFactValue = string | number | boolean | null | string[];
export type ProductFactSource = "observed" | "user_provided" | "inferred";

export interface ProductFact<T extends ProductFactValue = ProductFactValue> {
  fact_id: string;
  value: T;
  source: ProductFactSource;
  confidence: Confidence;
  evidence: ArtifactEvidence[];
  confirmed_by_user: boolean;
}

export interface ProductProfile {
  schema_version: VideoArtifactSchemaVersion;
  image_asset_ids: string[];
  category: ProductFact<string>;
  material: ProductFact<string>;
  shape: ProductFact<string>;
  colors: ProductFact<string[]>;
  key_parts: ProductFact<string>[];
  visual_features: ProductFact<string>[];
  supported_actions: ProductFact<string>[];
  possible_use_cases: ProductFact<string>[];
  limitations: ProductFact<string>[];
  claims: ProductFact<string>[];
  source_images: Array<{
    asset_id: string;
    view: string;
    quality: "low" | "medium" | "high";
  }>;
}

export interface AdaptedScene {
  scene_id: string;
  source_shot_ids: string[];
  input_fact_refs: string[];
  start_sec: number;
  end_sec: number;
  purpose: string;
  subject: string;
  environment: string;
  action: string;
  camera: string;
  lighting: string;
  selling_point: string;
  overlay_text: string;
  voiceover: string;
  retained_variables: string[];
  rewritten_variables: string[];
  adaptation_reason: string;
  image_prompt: string;
  video_prompt: string;
  negative_prompt: string;
  status: "draft" | "ready" | "needs_review";
}

export interface AdaptedBlueprint {
  schema_version: VideoArtifactSchemaVersion;
  target_market: string;
  language: string;
  target_duration_sec: number;
  similarity_score: number;
  creative_strategy: string;
  scenes: AdaptedScene[];
  localization_notes: string[];
  safety_notes: string[];
}

export type StoryboardGenerationStatus =
  | "not_generated"
  | "queued"
  | "generating"
  | "ready"
  | "needs_review"
  | "failed"
  | "stale";

export type StoryboardQcStatus = "pending" | "passed" | "needs_review" | "accepted" | "failed";

export interface StoryboardSceneDocument {
  schema_version: VideoArtifactSchemaVersion;
  scene_id: string;
  adapted_scene_id: string;
  source_shot_ids: string[];
  input_fact_refs: string[];
  start_sec: number;
  end_sec: number;
  purpose: string;
  headline: string;
  overlay_text: string;
  voiceover: string;
  image_prompt: string;
  video_prompt: string;
  negative_prompt: string;
  storyboard_asset_id: string | null;
}

export type ExportKind = "draft" | "final";
export type VideoExportStatus = "queued" | "building" | "ready" | "failed";

export interface PromptPackageSceneManifest {
  scene_id: string;
  position: number;
  revision_id: string;
  revision: number;
  generation: number;
  generation_status: StoryboardGenerationStatus;
  stale_reason: string | null;
  qc_status: StoryboardQcStatus;
  qc_accepted: boolean;
  locked_revision_id: string | null;
  storyboard_asset_id: string | null;
}

export interface PromptPackageManifest {
  schema_version: VideoArtifactSchemaVersion;
  export_id: string;
  project_id: string;
  kind: ExportKind;
  created_at: string;
  source_blueprint_id: string;
  product_profile_id: string;
  adapted_blueprint_id: string;
  scenes: PromptPackageSceneManifest[];
  excluded_source_material: Array<"source_video" | "source_audio" | "full_transcript">;
  files: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
}
