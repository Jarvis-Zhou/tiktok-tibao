import { createHash } from "node:crypto";
import {
  assertAdaptedBlueprint,
  assertProductProfile,
  assertPromptPackageManifest,
  assertSourceVideoAnalysis,
  type ExportKind,
  type PromptPackageManifest,
  type PromptPackageSceneManifest,
} from "@tibao/video-core";
import { createStoredZip } from "./zip.js";

export interface PromptPackageSnapshotScene extends PromptPackageSceneManifest {
  data: Record<string, unknown>;
  storyboard_storage_key: string | null;
  storyboard_mime_type: string | null;
}
export interface PromptPackageSnapshot {
  export_id: string;
  project_id: string;
  project_name: string;
  target_market: string;
  language: string;
  kind: ExportKind;
  created_at: string;
  source: { id: string; data: unknown };
  product: { id: string; data: unknown };
  adapted: { id: string; data: unknown };
  scenes: PromptPackageSnapshotScene[];
}

export interface BuiltPromptPackage {
  zip: Buffer;
  manifest: PromptPackageManifest;
}

function json(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function buildPromptPackage(
  snapshot: PromptPackageSnapshot,
  readAsset: (storageKey: string) => Promise<Buffer>,
): Promise<BuiltPromptPackage> {
  assertSourceVideoAnalysis(snapshot.source.data);
  assertProductProfile(snapshot.product.data);
  const sourceShotIds = new Set(snapshot.source.data.shots.map((shot) => shot.shot_id));
  const confirmedFactIds = new Set<string>();
  const productFacts = [
    snapshot.product.data.category,
    snapshot.product.data.material,
    snapshot.product.data.shape,
    snapshot.product.data.colors,
    ...snapshot.product.data.key_parts,
    ...snapshot.product.data.visual_features,
    ...snapshot.product.data.supported_actions,
    ...snapshot.product.data.possible_use_cases,
    ...snapshot.product.data.limitations,
    ...snapshot.product.data.claims,
  ];
  for (const fact of productFacts) if (fact.confirmed_by_user || fact.source !== "inferred") confirmedFactIds.add(fact.fact_id);
  assertAdaptedBlueprint(snapshot.adapted.data, { sourceShotIds, confirmedFactIds });

  const entries: Array<{ path: string; data: Buffer }> = [];
  entries.push({
    path: "project-summary.md",
    data: Buffer.from([
      `# ${snapshot.project_name}`,
      "",
      `- Export: ${snapshot.kind}`,
      `- Market: ${snapshot.target_market}`,
      `- Language: ${snapshot.language}`,
      `- Scenes: ${snapshot.scenes.length}`,
      "",
      "This package intentionally excludes the source video, source audio, and full transcript.",
      "",
    ].join("\n"), "utf8"),
  });
  entries.push({ path: "source-blueprint.json", data: json(snapshot.source.data) });
  entries.push({ path: "product-profile.json", data: json(snapshot.product.data) });
  entries.push({ path: "adapted-blueprint.json", data: json(snapshot.adapted.data) });
  const promptLines = ["# Scene prompts", ""];
  for (const scene of snapshot.scenes) {
    const display = String(scene.position).padStart(2, "0");
    promptLines.push(`## Scene ${display}`, "");
    promptLines.push(`- Headline: ${textValue(scene.data.headline)}`);
    promptLines.push(`- Image prompt: ${textValue(scene.data.image_prompt) || textValue(scene.data.prompt)}`);
    promptLines.push(`- Video prompt: ${textValue(scene.data.video_prompt)}`);
    promptLines.push(`- Negative prompt: ${textValue(scene.data.negative_prompt)}`);
    promptLines.push(`- Voiceover: ${textValue(scene.data.voiceover) || textValue(scene.data.script)}`, "");
    if (scene.storyboard_storage_key) {
      const image = await readAsset(scene.storyboard_storage_key);
      const extension = scene.storyboard_mime_type === "image/webp" ? "webp" : scene.storyboard_mime_type === "image/jpeg" ? "jpg" : "png";
      entries.push({ path: `storyboards/scene-${display}.${extension}`, data: image });
    }
  }
  entries.push({ path: "prompts.md", data: Buffer.from(`${promptLines.join("\n")}\n`, "utf8") });
  const manifest: PromptPackageManifest = {
    schema_version: "1.0",
    export_id: snapshot.export_id,
    project_id: snapshot.project_id,
    kind: snapshot.kind,
    created_at: snapshot.created_at,
    source_blueprint_id: snapshot.source.id,
    product_profile_id: snapshot.product.id,
    adapted_blueprint_id: snapshot.adapted.id,
    scenes: snapshot.scenes.map(({ data: _data, storyboard_storage_key: _storage, storyboard_mime_type: _mime, ...scene }) => scene),
    excluded_source_material: ["source_video", "source_audio", "full_transcript"],
    files: entries.map((entry) => ({ path: entry.path, bytes: entry.data.length, sha256: sha256(entry.data) })),
  };
  assertPromptPackageManifest(manifest);
  entries.push({ path: "manifest.json", data: json(manifest) });
  return { zip: createStoredZip(entries), manifest };
}
