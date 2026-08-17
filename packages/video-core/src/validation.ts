import type { PrototypeAnalysisResult } from "./contracts.js";
import { VideoDomainError } from "./contracts.js";
import { assertAdaptedBlueprint, assertProductProfile, assertSourceVideoAnalysis } from "./artifact-validation.js";

export const PROTOTYPE_ANALYSIS_SCHEMA_VERSION = "prototype-analysis-v1" as const;

export const PROTOTYPE_ANALYSIS_SCHEMA_V1 = {
  $id: "https://tibao.local/schemas/prototype-analysis-v1.json",
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "summary",
    "source_blueprint",
    "product_profile",
    "adapted_blueprint",
    "scenes",
  ],
  properties: {
    schema_version: { const: PROTOTYPE_ANALYSIS_SCHEMA_VERSION },
    scenes: { type: "array", minItems: 3, maxItems: 6 },
  },
} as const;

export const ARTIFACT_ASSET_REFERENCE_POINTERS = {
  "source-video-analysis-v1": ["/source_asset_id"],
  "product-profile-v1": ["/image_asset_ids/*"],
  "adapted-blueprint-v1": [],
  "prototype-scene-v1": ["/storyboard_asset_id"],
  "storyboard-scene-v1": ["/storyboard_asset_id"],
  "prompt-package-manifest-v1": ["/scenes/*/storyboard_asset_id"],
} as const;

export type ArtifactSchemaVersion = keyof typeof ARTIFACT_ASSET_REFERENCE_POINTERS;

export function extractSchemaAssetReferences(
  schemaVersion: ArtifactSchemaVersion,
  value: unknown,
): string[] {
  const pointers = ARTIFACT_ASSET_REFERENCE_POINTERS[schemaVersion];
  const references = new Set<string>();
  for (const pointer of pointers) {
    const segments = pointer
      .split("/")
      .slice(1)
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
    let candidates: unknown[] = [value];
    for (const segment of segments) {
      const next: unknown[] = [];
      for (const candidate of candidates) {
        if (segment === "*") {
          if (Array.isArray(candidate)) next.push(...candidate);
        } else if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          next.push((candidate as Record<string, unknown>)[segment]);
        }
      }
      candidates = next;
    }
    for (const candidate of candidates) if (typeof candidate === "string" && candidate) references.add(candidate);
  }
  return [...references];
}

export function assertPrototypeAnalysisResult(value: unknown): asserts value is PrototypeAnalysisResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VideoDomainError({
      code: "BLUEPRINT_SCHEMA_INVALID",
      message: "Fake Provider returned a non-object result",
    });
  }
  const result = value as Partial<PrototypeAnalysisResult>;
  if (result.schema_version !== PROTOTYPE_ANALYSIS_SCHEMA_VERSION) {
    throw new VideoDomainError({
      code: "BLUEPRINT_SCHEMA_INVALID",
      message: "Unsupported prototype analysis schema version",
    });
  }
  if (!Array.isArray(result.scenes) || result.scenes.length < 3 || result.scenes.length > 6) {
    throw new VideoDomainError({
      code: "BLUEPRINT_SCHEMA_INVALID",
      message: "Storyboard must contain between 3 and 6 scenes",
    });
  }
  assertSourceVideoAnalysis(result.source_blueprint);
  assertProductProfile(result.product_profile);
  const sourceShotIds = new Set(result.source_blueprint.shots.map((shot) => shot.shot_id));
  const confirmedFactIds = new Set<string>();
  const profile = result.product_profile;
  const facts = [
    profile.category,
    profile.material,
    profile.shape,
    profile.colors,
    ...profile.key_parts,
    ...profile.visual_features,
    ...profile.supported_actions,
    ...profile.possible_use_cases,
    ...profile.limitations,
    ...profile.claims,
  ];
  for (const fact of facts) if (fact.confirmed_by_user || fact.source !== "inferred") confirmedFactIds.add(fact.fact_id);
  const adaptedBlueprint = result.adapted_blueprint;
  assertAdaptedBlueprint(adaptedBlueprint, {
    sourceShotIds,
    confirmedFactIds,
  });
  const positions = new Set<number>();
  for (const scene of result.scenes) {
    if (!Number.isInteger(scene.position) || scene.position < 1 || positions.has(scene.position)) {
      throw new VideoDomainError({
        code: "BLUEPRINT_SCHEMA_INVALID",
        message: "Storyboard scene positions must be unique positive integers",
      });
    }
    if (!(scene.duration_sec > 0) || !scene.headline.trim() || !scene.prompt.trim()) {
      throw new VideoDomainError({
        code: "BLUEPRINT_SCHEMA_INVALID",
        message: "Storyboard scenes require duration, headline, and prompt",
      });
    }
    positions.add(scene.position);
  }
}

export function normalizeMarket(value: unknown): string {
  const market = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(market)) {
    throw new VideoDomainError({ code: "INVALID_MARKET", message: "target_market must be an ISO alpha-2 code" });
  }
  return market;
}

export function normalizeLanguage(value: unknown): string {
  const language = typeof value === "string" ? value.trim() : "";
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) {
    throw new VideoDomainError({ code: "INVALID_LANGUAGE", message: "language must be a supported BCP 47 tag" });
  }
  return language;
}
