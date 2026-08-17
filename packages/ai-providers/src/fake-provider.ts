import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import type {
  ProductFact,
  PrototypeAnalysisResult,
  PrototypeScene,
  SourceShot,
} from "@tibao/video-core";
import type {
  GeneratedStoryboardImage,
  PrototypeAnalysisInput,
  PrototypeAnalysisProvider,
  StoryboardImageInput,
  StoryboardImageProvider,
} from "./contracts.js";

const SCENE_TEMPLATES = [
  ["HOOK", "钩子", "反常识开场", "指出常见误区，制造信息缺口", 2.6],
  ["PAIN", "痛点", "放大真实困扰", "用具体结果建立共鸣", 3.2],
  ["REVEAL", "亮相", "商品第一次露出", "先说解决机制，再展示商品", 3.8],
  ["DEMO", "演示", "三步使用演示", "每个动作只表达一件事", 5.2],
  ["PROOF", "证据", "结果与细节证明", "用近景和时间标签建立可信度", 6],
  ["CTA", "收口", "低压力行动号召", "复述收益并引导查看详情", 4.2],
] as const;

const TEMPLATE_DURATION = SCENE_TEMPLATES.reduce((sum, template) => sum + template[4], 0);

function abortError(): Error {
  const error = new Error("Provider call aborted");
  error.name = "AbortError";
  return error;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function timeline(totalDuration: number): Array<{ start: number; end: number; duration: number }> {
  let cursor = 0;
  return SCENE_TEMPLATES.map((template, index) => {
    const start = cursor;
    const end = index === SCENE_TEMPLATES.length - 1
      ? round2(totalDuration)
      : round2(cursor + (template[4] / TEMPLATE_DURATION) * totalDuration);
    cursor = end;
    return { start, end, duration: round2(end - start) };
  });
}

function fact<T extends string | string[]>(
  factId: string,
  value: T,
  input: PrototypeAnalysisInput,
  source: ProductFact<T>["source"],
  confirmedByUser: boolean,
): ProductFact<T> {
  return {
    fact_id: factId,
    value,
    source,
    confidence: source === "inferred" ? 0.55 : 0.96,
    evidence: input.productAssetIds.map((assetId) => ({ asset_id: assetId })),
    confirmed_by_user: confirmedByUser,
  };
}

function sceneCopies(index: number, productName: string): readonly [string, string, string, string] {
  const copies: ReadonlyArray<readonly [string, string, string, string]> = [
    ["先别急着下结论", "别急", "信息缺口 · 0.8s", "你可能忽略了关键一步"],
    ["真正的问题藏在细节里", "细节", "痛点共鸣 · 3 连击", "结果不好，不一定是产品没用"],
    [`让 ${productName} 在这里自然出现`, productName, "商品露出 · 58% 画面", `${productName} 进入解决路径`],
    ["展示动作，而不是堆卖点", "动作", "动作节拍 · FAST", "一步一件事，画面更容易看懂"],
    ["用真实细节建立信任", "真实细节", "Before / After · 同条件", "同光线、同角度、标记时间"],
    ["适合你，再查看商品详情", "适合你", "CTA · 商品锚点", "先判断需求，再做选择"],
  ];
  return copies[index] ?? copies[0]!;
}

function sourceShots(input: PrototypeAnalysisInput, sourceDuration: number): SourceShot[] {
  return timeline(sourceDuration).map((timing, index) => {
    const template = SCENE_TEMPLATES[index]!;
    return {
      shot_id: `source-${index + 1}`,
      start_sec: timing.start,
      end_sec: timing.end,
      camera_angle: index === 3 ? "top-down" : "eye-level",
      framing: index === 0 ? "close-up" : "medium close-up",
      subject: index >= 2 ? "product and hands" : "problem context",
      action: template[3],
      camera_motion: index === 3 ? "quick cuts" : "stable",
      purpose: template[0].toLowerCase(),
      on_screen_text: template[2],
      speech: "",
      visual_evidence: [{ asset_id: input.sourceAssetId, timestamp_sec: timing.start }],
      confidence: 0.9,
    };
  });
}

function prototypeScene(
  index: number,
  productName: string,
  timing: { start: number; end: number; duration: number },
): PrototypeScene {
  const template = SCENE_TEMPLATES[index]!;
  const [short, label, title, description] = template;
  const [headline, accent, overlay, caption] = sceneCopies(index, productName);
  const id = randomUUID();
  return {
    id,
    position: index + 1,
    generation_status: "not_generated",
    revision: 1,
    generation: 1,
    locked_revision_id: null,
    current_revision_id: null,
    stale_reason: null,
    qc_status: "pending",
    storyboard_asset_id: null,
    short,
    label,
    title,
    description,
    duration_sec: timing.duration,
    headline,
    accent,
    overlay,
    caption,
    script: `${headline}。${caption}。`,
    prompt: `Vertical 9:16 product storyboard. Scene ${index + 1}: ${description}. Feature ${productName} without copying a real person's identity, voice, logo, or copyrighted music.`,
  };
}

export class FakeVideoProvider implements PrototypeAnalysisProvider {
  readonly id = "fake";
  readonly model = "deterministic-prototype-v2";

  constructor(private readonly latencyMs = 25) {}

  async analyze(input: PrototypeAnalysisInput, signal: AbortSignal): Promise<PrototypeAnalysisResult> {
    if (signal.aborted) throw abortError();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.latencyMs);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    });
    const productName = input.catalogTitle?.trim() || input.catalogBrand?.trim() || "你的商品";
    const sourceDuration = round2(Math.max(3, Math.min(30, input.sourceDurationSec ?? TEMPLATE_DURATION)));
    const targetDuration = round2(Math.max(5, input.targetDurationSec ?? sourceDuration));
    const sourceTimeline = timeline(sourceDuration);
    const adaptedTimeline = timeline(targetDuration);
    const shots = sourceShots(input, sourceDuration);
    const scenes = adaptedTimeline.map((timing, index) => prototypeScene(index, productName, timing));
    const category = fact(
      "category.primary",
      input.catalogCategory?.trim() || "other",
      input,
      input.catalogCategory?.trim() ? "user_provided" : "inferred",
      Boolean(input.catalogCategory?.trim()),
    );
    const material = fact("material.primary", "needs confirmation", input, "inferred", false);
    const shape = fact("shape.primary", "product-specific", input, "observed", false);
    const colors = fact("colors.primary", ["from source images"], input, "observed", false);
    return {
      schema_version: "prototype-analysis-v1",
      summary: {
        title: `${productName} · ${input.targetMarket} Storyboard`,
        duration_sec: targetDuration,
        scene_count: scenes.length,
        confidence: 0.9,
      },
      source_blueprint: {
        schema_version: "1.0",
        source_asset_id: input.sourceAssetId,
        duration_sec: sourceDuration,
        aspect_ratio: input.sourceWidth && input.sourceHeight ? `${input.sourceWidth}:${input.sourceHeight}` : "9:16",
        video_type: "problem_solution",
        hook: {
          start_sec: sourceTimeline[0]!.start,
          end_sec: sourceTimeline[0]!.end,
          type: "contrarian",
          description: SCENE_TEMPLATES[0][3],
          evidence: [{ asset_id: input.sourceAssetId, timestamp_sec: 0 }],
          confidence: 0.91,
        },
        shots,
        selling_points: [{
          text: "Show the product through a concrete action rather than an unsupported claim",
          evidence: [{ asset_id: input.sourceAssetId, timestamp_sec: shots[2]!.start_sec }],
          confidence: 0.78,
        }],
        pace: "fast",
        avg_cut_interval_sec: round2(sourceDuration / shots.length),
        audio_style: {
          audio_available: input.audioAvailable === true,
          rhythm: "upbeat",
          mood: "confident",
          has_voiceover: false,
          transcript_status: input.audioAvailable === true ? "failed" : "skipped",
        },
        subtitle_style: { position: "bottom", density: "medium", description: "Short mobile-safe captions" },
        cta: {
          type: "soft",
          start_sec: shots.at(-1)!.start_sec,
          end_sec: sourceDuration,
          expression: "Check whether the product fits your needs",
        },
        viral_hypotheses: [{
          hypothesis: "A specific opening contradiction creates an information gap",
          evidence: [{ asset_id: input.sourceAssetId, timestamp_sec: 0 }],
          confidence: 0.76,
        }],
      },
      product_profile: {
        schema_version: "1.0",
        image_asset_ids: input.productAssetIds,
        category,
        material,
        shape,
        colors,
        key_parts: [],
        visual_features: [fact("visual.primary", productName, input, "observed", false)],
        supported_actions: [],
        possible_use_cases: [],
        limitations: [fact("limitation.claims", "Do not infer unverified efficacy", input, "inferred", false)],
        claims: [],
        source_images: input.productAssetIds.map((assetId, index) => ({
          asset_id: assetId,
          view: index === 0 ? "primary" : `view-${index + 1}`,
          quality: "high",
        })),
      },
      adapted_blueprint: {
        schema_version: "1.0",
        target_market: input.targetMarket,
        language: input.language,
        target_duration_sec: targetDuration,
        similarity_score: input.similarityScore,
        creative_strategy: "Retain the source pacing and functional shot roles while rewriting identity, claims, copy, and product actions.",
        scenes: scenes.map((scene, index) => ({
          scene_id: scene.id,
          source_shot_ids: [`source-${index + 1}`],
          input_fact_refs: category.confirmed_by_user ? [category.fact_id] : [],
          start_sec: adaptedTimeline[index]!.start,
          end_sec: adaptedTimeline[index]!.end,
          purpose: scene.short.toLowerCase(),
          subject: productName,
          environment: "neutral product demonstration set",
          action: scene.description,
          camera: index === 3 ? "top-down quick cuts" : "stable vertical close-up",
          lighting: "soft commercial lighting",
          selling_point: scene.caption,
          overlay_text: scene.overlay,
          voiceover: scene.script,
          retained_variables: ["shot role", "relative pacing"],
          rewritten_variables: ["product", "copy", "identity", "claims"],
          adaptation_reason: "Preserve structural intent without copying protected identity, voice, logo, music, or wording.",
          image_prompt: scene.prompt,
          video_prompt: `${scene.prompt} Camera movement: subtle and physically plausible.`,
          negative_prompt: "logos, watermarks, public figures, copied faces, copied subtitles, unsupported efficacy claims",
          status: "ready",
        })),
        localization_notes: [`Use natural ${input.language} phrasing for ${input.targetMarket}.`],
        safety_notes: ["Do not preserve the source person's identity, face, voice, logo, music, watermark, or verbatim subtitles."],
      },
      scenes,
    };
  }
}

let crcTable: Uint32Array | undefined;

function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  typeBytes.copy(header, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([header, data, checksum]);
}

function solidPng(width: number, height: number, seed: number): Buffer {
  const scanline = width * 3 + 1;
  const raw = Buffer.alloc(scanline * height);
  const red = 45 + (seed * 53) % 170;
  const green = 55 + (seed * 31) % 150;
  const blue = 75 + (seed * 71) % 160;
  for (let y = 0; y < height; y += 1) {
    const offset = y * scanline;
    raw[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = offset + 1 + x * 3;
      raw[pixel] = Math.min(255, red + Math.floor((x / width) * 20));
      raw[pixel + 1] = Math.min(255, green + Math.floor((y / height) * 20));
      raw[pixel + 2] = blue;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export class FakeStoryboardImageProvider implements StoryboardImageProvider {
  readonly id = "fake";
  readonly model = "deterministic-storyboard-v1";

  async generate(input: StoryboardImageInput, signal: AbortSignal): Promise<GeneratedStoryboardImage> {
    if (signal.aborted) throw abortError();
    const width = input.width ?? 180;
    const height = input.height ?? 320;
    const seed = [...input.sceneId].reduce((sum, character) => sum + character.charCodeAt(0), input.generation);
    return {
      mimeType: "image/png",
      bytes: solidPng(width, height, seed),
      width,
      height,
      qc: { status: "passed", productPresence: 0.94, visualConsistency: 0.91, textAnomaly: 0.02 },
    };
  }
}
