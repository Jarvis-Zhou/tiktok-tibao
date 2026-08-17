import type {
  AdaptedBlueprint,
  ProductFact,
  ProductProfile,
  PromptPackageManifest,
  SourceVideoAnalysis,
  StoryboardSceneDocument,
} from "./artifacts.js";
import { VIDEO_ARTIFACT_SCHEMA_VERSION } from "./artifacts.js";
import { VideoDomainError } from "./contracts.js";

export interface ArtifactValidationContext {
  sourceShotIds?: ReadonlySet<string>;
  confirmedFactIds?: ReadonlySet<string>;
  targetDurationSec?: number;
}
type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function invalid(message: string, details?: Record<string, unknown>): VideoDomainError {
  return new VideoDomainError({
    code: "BLUEPRINT_SCHEMA_INVALID",
    message,
    statusCode: 422,
    ...(details ? { details } : {}),
  });
}

function exactKeys(value: UnknownRecord, allowed: readonly string[], path: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw invalid(`${path} contains undeclared fields`, { path, fields: extras });
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw invalid(`${path} must be ${allowEmpty ? "a string" : "a non-empty string"}`);
  }
  return value;
}

function number(value: unknown, path: string, minimum?: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(`${path} must be a finite number`);
  if (minimum !== undefined && value < minimum) throw invalid(`${path} must be at least ${minimum}`);
  if (maximum !== undefined && value > maximum) throw invalid(`${path} must be at most ${maximum}`);
  return value;
}

function time(value: unknown, path: string): number {
  const result = number(value, path, 0);
  if (Math.abs(result * 100 - Math.round(result * 100)) > 1e-7) {
    throw invalid(`${path} must use at most two decimal places`);
  }
  return result;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${path} must be an array`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => string(item, `${path}[${index}]`));
}

function enumValue<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw invalid(`${path} must be one of ${choices.join(", ")}`);
  }
  return value as T;
}

function schemaVersion(value: UnknownRecord, path: string): void {
  if (value.schema_version !== VIDEO_ARTIFACT_SCHEMA_VERSION) {
    throw invalid(`${path}.schema_version must be ${VIDEO_ARTIFACT_SCHEMA_VERSION}`);
  }
}

function evidence(value: unknown, path: string): void {
  const item = record(value, path);
  exactKeys(item, ["asset_id", "timestamp_sec", "region", "note"], path);
  string(item.asset_id, `${path}.asset_id`);
  if (item.timestamp_sec !== undefined) time(item.timestamp_sec, `${path}.timestamp_sec`);
  if (item.note !== undefined) string(item.note, `${path}.note`, true);
  if (item.region !== undefined) {
    const region = array(item.region, `${path}.region`);
    if (region.length !== 4) throw invalid(`${path}.region must contain four normalized coordinates`);
    region.forEach((coordinate, index) => number(coordinate, `${path}.region[${index}]`, 0, 1));
  }
}

function evidenceArray(value: unknown, path: string, requireOne = false): void {
  const items = array(value, path);
  if (requireOne && items.length === 0) throw invalid(`${path} must include evidence`);
  items.forEach((item, index) => evidence(item, `${path}[${index}]`));
}

function validateIntervals(
  intervals: Array<{ id: string; start: number; end: number }>,
  path: string,
): void {
  const ids = new Set<string>();
  let priorEnd = 0;
  for (const interval of intervals) {
    if (ids.has(interval.id)) throw invalid(`${path} ids must be unique`, { duplicate_id: interval.id });
    if (interval.end <= interval.start) throw invalid(`${path} start_sec must be less than end_sec`, { id: interval.id });
    if (interval.start < priorEnd - 0.0001) throw invalid(`${path} must not overlap`, { id: interval.id });
    ids.add(interval.id);
    priorEnd = interval.end;
  }
}

export function assertSourceVideoAnalysis(value: unknown): asserts value is SourceVideoAnalysis {
  const source = record(value, "source");
  exactKeys(source, [
    "schema_version", "source_asset_id", "duration_sec", "aspect_ratio", "video_type", "hook", "shots",
    "selling_points", "pace", "avg_cut_interval_sec", "audio_style", "subtitle_style", "cta", "viral_hypotheses",
  ], "source");
  schemaVersion(source, "source");
  string(source.source_asset_id, "source.source_asset_id");
  const duration = time(source.duration_sec, "source.duration_sec");
  if (duration <= 0) throw invalid("source.duration_sec must be positive");
  string(source.aspect_ratio, "source.aspect_ratio");
  enumValue(source.video_type, ["problem_solution", "demo", "before_after", "listicle", "testimonial", "other"], "source.video_type");

  const hook = record(source.hook, "source.hook");
  exactKeys(hook, ["start_sec", "end_sec", "type", "description", "evidence", "confidence"], "source.hook");
  const hookStart = time(hook.start_sec, "source.hook.start_sec");
  const hookEnd = time(hook.end_sec, "source.hook.end_sec");
  if (hookEnd <= hookStart || hookEnd > duration + 0.01) throw invalid("source.hook timing is outside the video");
  enumValue(hook.type, ["question", "contrarian", "demonstration", "result_first", "other"], "source.hook.type");
  string(hook.description, "source.hook.description");
  evidenceArray(hook.evidence, "source.hook.evidence", true);
  number(hook.confidence, "source.hook.confidence", 0, 1);

  const shots = array(source.shots, "source.shots");
  if (shots.length === 0) throw invalid("source.shots must contain at least one shot");
  const intervals = shots.map((candidate, index) => {
    const shot = record(candidate, `source.shots[${index}]`);
    exactKeys(shot, [
      "shot_id", "start_sec", "end_sec", "camera_angle", "framing", "subject", "action", "camera_motion",
      "purpose", "on_screen_text", "speech", "visual_evidence", "confidence",
    ], `source.shots[${index}]`);
    const id = string(shot.shot_id, `source.shots[${index}].shot_id`);
    const start = time(shot.start_sec, `source.shots[${index}].start_sec`);
    const end = time(shot.end_sec, `source.shots[${index}].end_sec`);
    for (const key of ["camera_angle", "framing", "subject", "action", "camera_motion", "purpose"] as const) {
      string(shot[key], `source.shots[${index}].${key}`);
    }
    string(shot.on_screen_text, `source.shots[${index}].on_screen_text`, true);
    string(shot.speech, `source.shots[${index}].speech`, true);
    evidenceArray(shot.visual_evidence, `source.shots[${index}].visual_evidence`, true);
    number(shot.confidence, `source.shots[${index}].confidence`, 0, 1);
    return { id, start, end };
  });
  validateIntervals(intervals, "source.shots");
  if (intervals.at(-1)!.end > duration + 0.01) throw invalid("source.shots extend beyond duration_sec");
  const coverage = intervals.reduce((sum, item) => sum + item.end - item.start, 0) / duration;
  if (coverage < 0.9) throw invalid("source.shots must cover at least 90% of the video", { coverage });

  array(source.selling_points, "source.selling_points").forEach((candidate, index) => {
    const item = record(candidate, `source.selling_points[${index}]`);
    exactKeys(item, ["text", "evidence", "confidence"], `source.selling_points[${index}]`);
    string(item.text, `source.selling_points[${index}].text`);
    evidenceArray(item.evidence, `source.selling_points[${index}].evidence`, true);
    number(item.confidence, `source.selling_points[${index}].confidence`, 0, 1);
  });
  enumValue(source.pace, ["slow", "medium", "fast"], "source.pace");
  number(source.avg_cut_interval_sec, "source.avg_cut_interval_sec", 0);
  const audio = record(source.audio_style, "source.audio_style");
  exactKeys(audio, ["audio_available", "rhythm", "mood", "has_voiceover", "transcript_status"], "source.audio_style");
  if (typeof audio.audio_available !== "boolean" || typeof audio.has_voiceover !== "boolean") throw invalid("source.audio_style booleans are invalid");
  string(audio.rhythm, "source.audio_style.rhythm");
  string(audio.mood, "source.audio_style.mood");
  enumValue(audio.transcript_status, ["available", "skipped", "failed"], "source.audio_style.transcript_status");
  const subtitle = record(source.subtitle_style, "source.subtitle_style");
  exactKeys(subtitle, ["position", "density", "description"], "source.subtitle_style");
  enumValue(subtitle.position, ["top", "center", "bottom", "mixed", "other"], "source.subtitle_style.position");
  enumValue(subtitle.density, ["low", "medium", "high", "other"], "source.subtitle_style.density");
  string(subtitle.description, "source.subtitle_style.description", true);
  const cta = record(source.cta, "source.cta");
  exactKeys(cta, ["type", "start_sec", "end_sec", "expression"], "source.cta");
  enumValue(cta.type, ["shop_now", "learn_more", "soft", "none", "other"], "source.cta.type");
  const ctaStart = time(cta.start_sec, "source.cta.start_sec");
  const ctaEnd = time(cta.end_sec, "source.cta.end_sec");
  if (ctaEnd < ctaStart || ctaEnd > duration + 0.01) throw invalid("source.cta timing is invalid");
  string(cta.expression, "source.cta.expression", true);
  array(source.viral_hypotheses, "source.viral_hypotheses").forEach((candidate, index) => {
    const item = record(candidate, `source.viral_hypotheses[${index}]`);
    exactKeys(item, ["hypothesis", "evidence", "confidence"], `source.viral_hypotheses[${index}]`);
    string(item.hypothesis, `source.viral_hypotheses[${index}].hypothesis`);
    evidenceArray(item.evidence, `source.viral_hypotheses[${index}].evidence`, true);
    number(item.confidence, `source.viral_hypotheses[${index}].confidence`, 0, 1);
  });
}

function productFact(value: unknown, path: string, ids: Set<string>): ProductFact {
  const fact = record(value, path);
  exactKeys(fact, ["fact_id", "value", "source", "confidence", "evidence", "confirmed_by_user"], path);
  const factId = string(fact.fact_id, `${path}.fact_id`);
  if (ids.has(factId)) throw invalid("Product fact ids must be unique", { duplicate_fact_id: factId });
  ids.add(factId);
  const factValue = fact.value;
  const scalar = factValue === null || ["string", "number", "boolean"].includes(typeof factValue);
  const list = Array.isArray(factValue) && factValue.every((item) => typeof item === "string");
  if (!scalar && !list) throw invalid(`${path}.value has an unsupported type`);
  enumValue(fact.source, ["observed", "user_provided", "inferred"], `${path}.source`);
  number(fact.confidence, `${path}.confidence`, 0, 1);
  evidenceArray(fact.evidence, `${path}.evidence`);
  if (typeof fact.confirmed_by_user !== "boolean") throw invalid(`${path}.confirmed_by_user must be a boolean`);
  return fact as unknown as ProductFact;
}

export function assertProductProfile(value: unknown): asserts value is ProductProfile {
  const profile = record(value, "product_profile");
  exactKeys(profile, [
    "schema_version", "image_asset_ids", "category", "material", "shape", "colors", "key_parts", "visual_features",
    "supported_actions", "possible_use_cases", "limitations", "claims", "source_images",
  ], "product_profile");
  schemaVersion(profile, "product_profile");
  const imageIds = stringArray(profile.image_asset_ids, "product_profile.image_asset_ids");
  if (imageIds.length < 1 || imageIds.length > 6 || new Set(imageIds).size !== imageIds.length) {
    throw invalid("product_profile.image_asset_ids must contain 1–6 unique assets");
  }
  const ids = new Set<string>();
  for (const key of ["category", "material", "shape", "colors"] as const) productFact(profile[key], `product_profile.${key}`, ids);
  for (const key of ["key_parts", "visual_features", "supported_actions", "possible_use_cases", "limitations", "claims"] as const) {
    array(profile[key], `product_profile.${key}`).forEach((item, index) => productFact(item, `product_profile.${key}[${index}]`, ids));
  }
  array(profile.source_images, "product_profile.source_images").forEach((candidate, index) => {
    const image = record(candidate, `product_profile.source_images[${index}]`);
    exactKeys(image, ["asset_id", "view", "quality"], `product_profile.source_images[${index}]`);
    const assetId = string(image.asset_id, `product_profile.source_images[${index}].asset_id`);
    if (!imageIds.includes(assetId)) throw invalid("product_profile.source_images references an unknown image asset");
    string(image.view, `product_profile.source_images[${index}].view`);
    enumValue(image.quality, ["low", "medium", "high"], `product_profile.source_images[${index}].quality`);
  });
}

export function assertAdaptedBlueprint(
  value: unknown,
  context: ArtifactValidationContext = {},
): asserts value is AdaptedBlueprint {
  const blueprint = record(value, "adapted_blueprint");
  exactKeys(blueprint, [
    "schema_version", "target_market", "language", "target_duration_sec", "similarity_score", "creative_strategy",
    "scenes", "localization_notes", "safety_notes",
  ], "adapted_blueprint");
  schemaVersion(blueprint, "adapted_blueprint");
  string(blueprint.target_market, "adapted_blueprint.target_market");
  string(blueprint.language, "adapted_blueprint.language");
  const targetDuration = time(blueprint.target_duration_sec, "adapted_blueprint.target_duration_sec");
  number(blueprint.similarity_score, "adapted_blueprint.similarity_score", 0, 100);
  string(blueprint.creative_strategy, "adapted_blueprint.creative_strategy");
  stringArray(blueprint.localization_notes, "adapted_blueprint.localization_notes");
  stringArray(blueprint.safety_notes, "adapted_blueprint.safety_notes");
  const scenes = array(blueprint.scenes, "adapted_blueprint.scenes");
  if (scenes.length < 3 || scenes.length > 6) throw invalid("adapted_blueprint.scenes must contain 3–6 scenes");
  const intervals = scenes.map((candidate, index) => {
    const scene = record(candidate, `adapted_blueprint.scenes[${index}]`);
    exactKeys(scene, [
      "scene_id", "source_shot_ids", "input_fact_refs", "start_sec", "end_sec", "purpose", "subject", "environment",
      "action", "camera", "lighting", "selling_point", "overlay_text", "voiceover", "retained_variables",
      "rewritten_variables", "adaptation_reason", "image_prompt", "video_prompt", "negative_prompt", "status",
    ], `adapted_blueprint.scenes[${index}]`);
    const id = string(scene.scene_id, `adapted_blueprint.scenes[${index}].scene_id`);
    const sourceShotIds = stringArray(scene.source_shot_ids, `adapted_blueprint.scenes[${index}].source_shot_ids`);
    if (sourceShotIds.length === 0) throw invalid(`adapted_blueprint.scenes[${index}] must reference source shots`);
    if (context.sourceShotIds && sourceShotIds.some((shotId) => !context.sourceShotIds!.has(shotId))) {
      throw invalid(`adapted_blueprint.scenes[${index}] references an unknown source shot`);
    }
    const factRefs = stringArray(scene.input_fact_refs, `adapted_blueprint.scenes[${index}].input_fact_refs`);
    if (context.confirmedFactIds && factRefs.some((factId) => !context.confirmedFactIds!.has(factId))) {
      throw invalid(`adapted_blueprint.scenes[${index}] references an unconfirmed product fact`);
    }
    const start = time(scene.start_sec, `adapted_blueprint.scenes[${index}].start_sec`);
    const end = time(scene.end_sec, `adapted_blueprint.scenes[${index}].end_sec`);
    for (const key of [
      "purpose", "subject", "environment", "action", "camera", "lighting", "selling_point", "adaptation_reason",
      "image_prompt", "video_prompt", "negative_prompt",
    ] as const) string(scene[key], `adapted_blueprint.scenes[${index}].${key}`);
    string(scene.overlay_text, `adapted_blueprint.scenes[${index}].overlay_text`, true);
    string(scene.voiceover, `adapted_blueprint.scenes[${index}].voiceover`, true);
    stringArray(scene.retained_variables, `adapted_blueprint.scenes[${index}].retained_variables`);
    stringArray(scene.rewritten_variables, `adapted_blueprint.scenes[${index}].rewritten_variables`);
    enumValue(scene.status, ["draft", "ready", "needs_review"], `adapted_blueprint.scenes[${index}].status`);
    return { id, start, end };
  });
  validateIntervals(intervals, "adapted_blueprint.scenes");
  const actualDuration = intervals.at(-1)!.end;
  if (Math.abs(actualDuration - targetDuration) > 0.5) throw invalid("adapted_blueprint total duration differs by more than 0.5 seconds");
  if (context.targetDurationSec !== undefined && Math.abs(targetDuration - context.targetDurationSec) > 0.5) {
    throw invalid("adapted_blueprint target duration does not match the requested duration");
  }
}

export function assertStoryboardSceneDocument(value: unknown): asserts value is StoryboardSceneDocument {
  const scene = record(value, "storyboard_scene");
  exactKeys(scene, [
    "schema_version", "scene_id", "adapted_scene_id", "source_shot_ids", "input_fact_refs", "start_sec", "end_sec",
    "purpose", "headline", "overlay_text", "voiceover", "image_prompt", "video_prompt", "negative_prompt",
    "storyboard_asset_id",
  ], "storyboard_scene");
  schemaVersion(scene, "storyboard_scene");
  for (const key of ["scene_id", "adapted_scene_id", "purpose", "headline", "image_prompt", "video_prompt", "negative_prompt"] as const) {
    string(scene[key], `storyboard_scene.${key}`);
  }
  string(scene.overlay_text, "storyboard_scene.overlay_text", true);
  string(scene.voiceover, "storyboard_scene.voiceover", true);
  stringArray(scene.source_shot_ids, "storyboard_scene.source_shot_ids");
  stringArray(scene.input_fact_refs, "storyboard_scene.input_fact_refs");
  const start = time(scene.start_sec, "storyboard_scene.start_sec");
  const end = time(scene.end_sec, "storyboard_scene.end_sec");
  if (end <= start) throw invalid("storyboard_scene timing is invalid");
  if (scene.storyboard_asset_id !== null) string(scene.storyboard_asset_id, "storyboard_scene.storyboard_asset_id");
}

export function assertPromptPackageManifest(value: unknown): asserts value is PromptPackageManifest {
  const manifest = record(value, "manifest");
  exactKeys(manifest, [
    "schema_version", "export_id", "project_id", "kind", "created_at", "source_blueprint_id", "product_profile_id",
    "adapted_blueprint_id", "scenes", "excluded_source_material", "files",
  ], "manifest");
  schemaVersion(manifest, "manifest");
  for (const key of ["export_id", "project_id", "created_at", "source_blueprint_id", "product_profile_id", "adapted_blueprint_id"] as const) {
    string(manifest[key], `manifest.${key}`);
  }
  enumValue(manifest.kind, ["draft", "final"], "manifest.kind");
  const exclusions = stringArray(manifest.excluded_source_material, "manifest.excluded_source_material");
  for (const required of ["source_video", "source_audio", "full_transcript"]) {
    if (!exclusions.includes(required)) throw invalid(`manifest must exclude ${required}`);
  }
  array(manifest.scenes, "manifest.scenes");
  array(manifest.files, "manifest.files").forEach((candidate, index) => {
    const file = record(candidate, `manifest.files[${index}]`);
    exactKeys(file, ["path", "bytes", "sha256"], `manifest.files[${index}]`);
    string(file.path, `manifest.files[${index}].path`);
    number(file.bytes, `manifest.files[${index}].bytes`, 0);
    const hash = string(file.sha256, `manifest.files[${index}].sha256`);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw invalid(`manifest.files[${index}].sha256 is invalid`);
  });
}
