import { randomUUID } from "node:crypto";
import type { PrototypeAnalysisResult, PrototypeScene } from "@tibao/video-core";
import type { PrototypeAnalysisInput, PrototypeAnalysisProvider } from "./contracts.js";

const SCENE_TEMPLATES = [
  ["HOOK", "钩子", "反常识开场", "指出常见误区，制造信息缺口", 2.6],
  ["PAIN", "痛点", "放大真实困扰", "用具体结果建立共鸣", 3.2],
  ["REVEAL", "亮相", "商品第一次露出", "先说解决机制，再展示商品", 3.8],
  ["DEMO", "演示", "三步使用演示", "每个动作只表达一件事", 5.2],
  ["PROOF", "证据", "结果与细节证明", "用近景和时间标签建立可信度", 6],
  ["CTA", "收口", "低压力行动号召", "复述收益并引导查看详情", 4.2],
] as const;

function abortError(): Error {
  const error = new Error("Provider call aborted");
  error.name = "AbortError";
  return error;
}

function sceneFromTemplate(
  template: (typeof SCENE_TEMPLATES)[number],
  index: number,
  productName: string,
): PrototypeScene {
  const [short, label, title, description, duration] = template;
  const copies = [
    ["先别急着下结论", "别急", "信息缺口 · 0.8s", "你可能忽略了关键一步"],
    ["真正的问题藏在细节里", "细节", "痛点共鸣 · 3 连击", "结果不好，不一定是产品没用"],
    [`让 ${productName} 在这里自然出现`, productName, "商品露出 · 58% 画面", `${productName} 进入解决路径`],
    ["展示动作，而不是堆卖点", "动作", "动作节拍 · FAST", "一步一件事，画面更容易看懂"],
    ["用真实细节建立信任", "真实细节", "Before / After · 同条件", "同光线、同角度、标记时间"],
    ["适合你，再查看商品详情", "适合你", "CTA · 商品锚点", "先判断需求，再做选择"],
  ] as const;
  const copy = copies[index] ?? [title, label, description, title];
  const [headline, accent, overlay, caption] = copy;
  return {
    id: randomUUID(),
    position: index + 1,
    generation_status: "ready",
    revision: 1,
    generation: 1,
    locked_revision_id: null,
    stale_reason: null,
    short,
    label,
    title,
    description,
    duration_sec: duration,
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
  readonly model = "deterministic-prototype-v1";

  constructor(private readonly latencyMs = 25) {}

  async analyze(input: PrototypeAnalysisInput, signal: AbortSignal): Promise<PrototypeAnalysisResult> {
    if (signal.aborted) throw abortError();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.latencyMs);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(abortError());
        },
        { once: true },
      );
    });
    const productName = input.catalogTitle?.trim() || input.catalogBrand?.trim() || "你的商品";
    const scenes = SCENE_TEMPLATES.map((template, index) =>
      sceneFromTemplate(template, index, productName),
    );
    const duration = scenes.reduce((sum, scene) => sum + scene.duration_sec, 0);
    return {
      schema_version: "prototype-analysis-v1",
      summary: {
        title: `${productName} · ${input.targetMarket} Storyboard`,
        duration_sec: duration,
        scene_count: scenes.length,
        confidence: 0.92,
      },
      source_blueprint: {
        schema_version: "source-video-analysis-v1",
        source_asset_id: input.sourceAssetId,
        duration_sec: duration,
        structure: scenes.map((scene) => ({
          position: scene.position,
          role: scene.short,
          duration_sec: scene.duration_sec,
        })),
      },
      product_profile: {
        schema_version: "product-profile-v1",
        title: productName,
        category: input.catalogCategory ?? "",
        brand: input.catalogBrand ?? "",
        target_market: input.targetMarket,
        image_asset_ids: input.productAssetIds,
        facts: [],
      },
      adapted_blueprint: {
        schema_version: "adapted-blueprint-v1",
        target_market: input.targetMarket,
        language: input.language,
        similarity_score: input.similarityScore,
        scenes: scenes.map((scene) => ({
          position: scene.position,
          source_shot_ids: [`source-${scene.position}`],
          input_fact_refs: [],
          role: scene.short,
          duration_sec: scene.duration_sec,
        })),
      },
      scenes,
    };
  }
}
