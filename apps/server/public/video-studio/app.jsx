const AUDIO_BARS = [8, 16, 10, 22, 14, 28, 18, 9, 24, 15, 30, 20, 11, 26, 17, 8, 21, 13, 27, 16, 9, 23, 12, 29, 18, 10, 25, 14, 20, 8, 24, 16, 11, 28, 18, 9, 22, 13, 26, 15, 10, 21, 12, 24, 16, 9, 19, 12, 22, 14, 8, 18, 11, 20, 13, 8, 16, 10, 18, 12];
const SCENE_COLORS = ["#d95e42", "#3b6486", "#3f8078", "#655b91", "#9b5671", "#a9793c"];
const DEMO_VIDEO_BASE64 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAM1bW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAC7gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAmB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAC7gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAcAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAu4AACAAAABAAAAAAHYbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAwABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABg21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUNzdGJsAAAAl3N0c2QAAAAAAAAAAQAAAIdhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAHABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMWF2Y0MBZAAK/+EAGGdkAAqs2VX7wEQAAAMABAAAAwAIPEiWWAEABmjr48siwAAAABhzdHRzAAAAAAAAAAEAAAADAABAAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAKGN0dHMAAAAAAAAAAwAAAAEAAIAAAAAAAQAAwAAAAAABAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAAAAAAAAAAAAAAAwAAAs4AAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAANlAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY1Ni40LjEwMQAAAAhmcmVlAAAC7m1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTQyIHIyNDkxIDI0ZTRmZWQgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDE0IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MTIgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAYZYiEABf//u6CvgU3X8QPwzzx+tAhUKXxAAAACEGaImxBX/7cAAAACAGeQXkFf1RB";
const DEMO_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAKklEQVR4nO3NMQ0AAAzDsPLHMZzTSKyfpdxxdlKtewcAAAAAAAAAAACPHdZiiFu/ZXsfAAAAAElFTkSuQmCC";

function fileFromBase64(value, name, type) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type });
}

async function videoApi(path, options = {}) {
  const response = await fetch(`/api/video/v1${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.error || `请求失败：${response.status}`;
    const error = new Error(detail);
    error.code = body?.error?.code || "VIDEO_API_FAILED";
    throw error;
  }
  return body;
}

function createIdempotencyKey() {
  const cryptoApi = window.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  return `tibao-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function writeHeaders() {
  return {
    "content-type": "application/json",
    "idempotency-key": createIdempotencyKey()
  };
}

function artifactData(analysis, key) {
  return analysis?.[key]?.data || null;
}

function assetContentUrl(assetId) {
  return assetId ? `/api/video/v1/assets/${encodeURIComponent(assetId)}/content` : "";
}

function projectScenes(items, analysis) {
  const adapted = artifactData(analysis, "adapted_blueprint");
  const source = artifactData(analysis, "source_blueprint");
  const adaptedScenes = Array.isArray(adapted?.scenes) ? adapted.scenes : [];
  const sourceShots = Array.isArray(source?.shots) ? source.shots : [];
  let start = 0;
  return items.map((scene, index) => {
    const adaptedScene = adaptedScenes.find((candidate) => candidate.scene_id === scene.id) || adaptedScenes[index] || null;
    const declaredStart = Number(adaptedScene?.start_sec);
    const declaredEnd = Number(adaptedScene?.end_sec);
    const hasDeclaredTiming = Number.isFinite(declaredStart) && Number.isFinite(declaredEnd) && declaredEnd > declaredStart;
    const duration = hasDeclaredTiming ? declaredEnd - declaredStart : Number(scene.duration_sec) || 1;
    const sceneStart = hasDeclaredTiming ? declaredStart : start;
    const sceneEnd = hasDeclaredTiming ? declaredEnd : sceneStart + duration;
    const sourceShotIds = Array.isArray(adaptedScene?.source_shot_ids) ? adaptedScene.source_shot_ids : [];
    const matchedSourceShots = sourceShots.filter((shot) => sourceShotIds.includes(shot.shot_id));
    const evidence = matchedSourceShots.flatMap((shot) => Array.isArray(shot.visual_evidence) ? shot.visual_evidence : []);
    const projected = {
      ...scene,
      duration: Math.max(0.01, duration),
      start: sceneStart,
      end: sceneEnd,
      sourceShotIds,
      sourceShots: matchedSourceShots,
      evidence,
      adaptationReason: adaptedScene?.adaptation_reason || "",
      storyboardUrl: assetContentUrl(scene.storyboard_asset_id),
      color: SCENE_COLORS[index % SCENE_COLORS.length]
    };
    start = sceneEnd;
    return projected;
  });
}

function projectDuration(scenes, analysis) {
  const adapted = artifactData(analysis, "adapted_blueprint");
  const source = artifactData(analysis, "source_blueprint");
  const sceneEnd = scenes.reduce((maximum, scene) => Math.max(maximum, Number(scene.end) || 0), 0);
  const adaptedDuration = Math.max(sceneEnd, Number(adapted?.target_duration_sec) || 0);
  return adaptedDuration > 0 ? adaptedDuration : Math.max(Number(source?.duration_sec) || 0, 0.01);
}

function sceneStatusLabel(scene) {
  const labels = {
    not_generated: "未生成",
    queued: "排队中",
    generating: "生成中",
    ready: "已就绪",
    needs_review: "待人工检查",
    failed: "生成失败",
    stale: "需重新生成"
  };
  return labels[scene?.generation_status] || scene?.generation_status || "未知";
}

function productFactText(profile, key) {
  const fact = profile?.[key];
  const value = fact?.value;
  const text = Array.isArray(value) ? value.join("、") : value == null ? "未识别" : String(value);
  return `${text} · ${fact?.source || "unknown"} · ${Number.isFinite(Number(fact?.confidence)) ? Math.round(Number(fact.confidence) * 100) : 0}%`;
}

function readLocal(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function readTibaoProduct() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("source") !== "tibao") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem("tibao:video-product") || "null");
    if (!value || typeof value !== "object") return null;
    const id = String(value.id || "").trim();
    if (!id || id !== params.get("productId")) return null;
    return {
      id,
      title: String(value.title || id),
      category: String(value.category || ""),
      brandName: String(value.brandName || ""),
      shopId: String(value.shopId || ""),
      shopRegion: String(value.shopRegion || "").toUpperCase()
    };
  } catch {
    return null;
  }
}

function hexToRgb(hex) {
  const clean = String(hex).replace("#", "");
  const full = clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean;
  const value = parseInt(full, 16);
  if (Number.isNaN(value)) return "255, 104, 70";
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

function formatTime(seconds, maximum = Number.POSITIVE_INFINITY) {
  const safeMaximum = Number.isFinite(maximum) ? maximum : Number.POSITIVE_INFINITY;
  const safe = Math.max(0, Math.min(safeMaximum, Number(seconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const hundredths = Math.floor((safe % 1) * 100);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function openTweaks() {
  window.postMessage({ type: "miaoda:tweaks:activate" }, "*");
}

function Sidebar({ screen, onNavigate, onAccount }) {
  const items = [
    { id: "home", icon: "home", label: "新建项目" },
    { id: "editor", icon: "spark", label: "生成工作台" },
    { id: "assets", icon: "folder", label: "素材库" },
    { id: "history", icon: "clock", label: "历史版本" }
  ];
  return (
    <aside className="sidebar" aria-label="主导航">
      <BrandMark compact={true} />
      <nav className="nav-stack">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-button ${(item.id === "home" && screen === "setup") || (item.id === "editor" && screen === "editor") ? "active" : ""}`}
            data-label={item.label}
            aria-label={item.label}
            onClick={() => onNavigate(item.id)}
          >
            <Icon name={item.icon} size={19} />
          </button>
        ))}
      </nav>
      <div className="nav-stack bottom">
        <button type="button" className="nav-button" data-label="风格设置" aria-label="风格设置" onClick={openTweaks}>
          <Icon name="settings" size={19} />
        </button>
        <button type="button" className="user-avatar" aria-label="打开账户菜单" onClick={onAccount}>TB</button>
      </div>
    </aside>
  );
}

function Topbar({ screen, generated, projectStatus, onBack, onGenerate, onExport, onToast }) {
  const editing = screen === "editor";
  return (
    <header className="topbar">
      <div className="topbar-title">
        {editing && (
          <button type="button" className="icon-button" aria-label="返回导入页" onClick={onBack}>
            <Icon name="back" size={17} />
          </button>
        )}
        <strong>{editing ? "商品视频重制工作台" : "创建新重制项目"}</strong>
        <span className="project-state demo-state">{projectStatus || "LOCAL ALPHA"}</span>
      </div>
      <div className="topbar-center" aria-label="保存状态">
        <span className="save-dot"></span>
        <span>刚刚自动保存</span>
      </div>
      <div className="topbar-actions">
        <a className="tibao-back-link" href="/">返回商品提报台</a>
        <button type="button" className="icon-button" aria-label="查看评论" onClick={() => onToast("暂无评论", "分享设计后，评论会出现在这里") }>
          <Icon name="comment" size={17} />
        </button>
        <button type="button" className="ghost-button" onClick={openTweaks}>
          <Icon name="settings" size={15} />
          风格
        </button>
        {editing && (
          generated ? (
            <button type="button" className="primary-button" onClick={onExport}>
              <Icon name="download" size={16} />
              导出 Prompt 包
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={onGenerate}>
              <Icon name="wand" size={16} />
              生成分镜
            </button>
          )
        )}
      </div>
    </header>
  );
}

function SetupScreen({ url, setUrl, referenceVideoName, onVideoUpload, onRemoveVideo, linkedProduct, productImage, productFileName, hasProduct, onUpload, onRemoveProduct, onDemo, onAnalyze, submitting, formError, language, setLanguage, length, setLength, providerInfo }) {
  const usingRealProvider = providerInfo?.provider === "openai";
  const usingRealStoryboard = providerInfo?.storyboard_provider === "openai";
  return (
    <section className="setup-screen" data-screen-label="新建重制项目">
      <div className="setup-wrap">
        <div className="setup-copy">
          <div className="eyebrow">Viral structure transfer</div>
          <h1>把爆款拆成一条<br /><span>可重做的时间线</span></h1>
          <p className="setup-lede">
            导入参考视频和商品素材。ReCut 会识别钩子、节奏、口播与商品露出时机，再把这套结构改写成你的版本。
          </p>
          <div className={`prototype-notice ${usingRealProvider ? "real-provider" : "fake-provider"}`}>
            <strong>{usingRealProvider ? "真实多模态 Provider" : "Fixture / Fake Provider"}</strong>
            <span>
              {usingRealProvider
                ? `参考帧、商品像素${providerInfo.analysis_model ? `会发送到 ${providerInfo.analysis_model}` : "会发送到已配置模型"}；${providerInfo.transcription_provider === "local" ? `音频由本地 ${providerInfo.transcription_model || "Whisper"} 转写` : providerInfo.transcription_provider === "openai" ? `音频由 ${providerInfo.transcription_model || "已配置 ASR"} 转写` : "音频转写未启用"}；${usingRealStoryboard ? `Storyboard 使用 ${providerInfo.storyboard_model || "已配置图片模型"}` : "Storyboard 暂用本地占位图，仅提示词与结构由真实模型生成"}。结果仍需人工复核，不生成 MP4。`
                : "FFmpeg、队列、持久化与导出是真实链路，但分析和 Storyboard 是确定性测试结果；请勿把它当作视频理解结论。"}
            </span>
          </div>
          <div className="workflow-strip" aria-label="重制流程">
            <div className="workflow-step"><span>01 · INPUT</span><strong>导入参考与商品</strong></div>
            <div className="workflow-step"><span>02 · DECODE</span><strong>拆解爆款结构</strong></div>
            <div className="workflow-step"><span>03 · REMIX</span><strong>生成可编辑分镜</strong></div>
          </div>
        </div>

        <div className="setup-card">
          <div className="card-title-row">
            <div>
              <h2>准备重制素材</h2>
              <p>先给系统一个结构参考，再加入你的商品。</p>
            </div>
            <button type="button" className="demo-link" onClick={onDemo}>载入演示项目</button>
          </div>
          <div className="setup-form">
            {linkedProduct && (
              <div className="linked-product">
                <span>来自 Tibao 选品</span>
                <strong>{linkedProduct.title}</strong>
                <small>{linkedProduct.id}{linkedProduct.category ? ` · ${linkedProduct.category}` : ""}</small>
              </div>
            )}
            <div>
              <label className="field-label" htmlFor="video-url">
                <span>参考视频链接</span>
                <small>链接用于预览；Alpha 分析需本地 MP4</small>
              </label>
              <div className="url-field">
                <Icon name="link" size={17} />
                <input
                  id="video-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="粘贴 TikTok 视频链接"
                  inputMode="url"
                />
                <span className="url-source">TK</span>
              </div>
              <div className="video-file-row">
                <span>或</span>
                {referenceVideoName ? (
                  <div className="selected-video-file">
                    <Icon name="film" size={15} />
                    <strong>{referenceVideoName}</strong>
                    <button type="button" aria-label="移除参考视频" onClick={onRemoveVideo}><Icon name="close" size={12} /></button>
                  </div>
                ) : (
                  <button type="button" className="video-upload-button" onClick={onVideoUpload}>
                    <Icon name="upload" size={15} /> 上传参考 MP4
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="field-label">
                <span>商品图片</span>
                <small>建议正面、侧面和使用场景</small>
              </div>
              <div className="material-row">
                <button type="button" className="upload-tile" onClick={onUpload}>
                  <span className="upload-orb"><Icon name="upload" size={18} /></span>
                  <strong>上传商品图片</strong>
                  <small>PNG / JPG / WebP · 1 张</small>
                </button>
                <div className={`product-tile ${hasProduct ? "has-file" : ""}`}>
                  {hasProduct ? (
                    <>
                      <ProductArt image={productImage} />
                      <button type="button" className="remove-product" aria-label="移除商品图片" onClick={onRemoveProduct}>
                        <Icon name="close" size={13} />
                      </button>
                      <div className="product-file-meta">
                        <span>{productFileName || "已上传商品图片"}</span>
                        <span>READY</span>
                      </div>
                    </>
                  ) : (
                    <span style={{ color: "var(--muted-2)", fontSize: 10 }}>等待商品素材</span>
                  )}
                </div>
              </div>
            </div>

            <div className="setting-line">
              <div className="compact-select">
                <select aria-label="目标语言" value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="ms-MY">Bahasa Melayu · MY</option>
                  <option value="en-MY">English · MY</option>
                </select>
              </div>
              <div className="compact-select">
                <select aria-label="目标时长" value={length} onChange={(event) => setLength(event.target.value)}>
                  <option value="auto">跟随参考视频</option>
                  <option value="15">精简版 · 15 秒</option>
                  <option value="35">完整演示 · 35 秒</option>
                </select>
              </div>
            </div>

            <div className="consent-line">
              <span className="consent-check"><Icon name="check" size={10} /></span>
              <span>我确认拥有所上传素材的使用权。系统只迁移视频结构，不复制原作者的人脸、声音、品牌标识或受版权保护的音乐。</span>
            </div>
            {formError && <div className="form-error" role="alert">{formError}</div>}
            <button type="button" className="primary-button analyze-button" onClick={onAnalyze} disabled={submitting}>
              <Icon name="spark" size={17} />
              {submitting ? "正在上传并创建作业…" : "分析爆款结构"}
              <Icon name="chevron" size={15} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function AnalysisScreen({ stage, sourcePreview, providerName }) {
  const steps = [
    { id: "media_probe", label: "探测参考视频" },
    { id: "frame_extraction", label: "抽取证据帧与音轨" },
    { id: "visual_analysis", label: `${providerName || "AI"} 分析 Source / Product / Adapted Blueprint` },
    { id: "schema_validation", label: "校验并持久化 Storyboard" }
  ];
  const stageOrder = [
    "queued", "starting", "media_probe", "frame_extraction", "asr_skipped_no_audio", "asr_unconfigured",
    "transcription_and_visual_analysis", "visual_analysis", "provider_submitted", "reconciling", "retry_wait",
    "schema_validation", "completed"
  ];
  const waitingForRetry = stage === "reconciling" || stage === "retry_wait";
  const currentIndex = Math.max(0, stageOrder.indexOf(stage));
  const progress = Math.round((currentIndex / (stageOrder.length - 1)) * 100);
  const stageLabel = stage === "reconciling"
    ? "等待安全重试"
    : stage === "retry_wait"
      ? "等待重试"
      : String(stage || "queued").toUpperCase();
  return (
    <section className="analysis-screen" data-screen-label="视频结构分析">
      <div className="analysis-grid"></div>
      <div className="analysis-card">
        <div className="analysis-video">
          <ReferenceFrame playing={true} source={sourcePreview} />
          <div className="scan-line"></div>
        </div>
        <div className="analysis-copy">
          <h2>{waitingForRetry ? "模型响应超时，等待自动重试" : "正在读取爆款 DNA"}</h2>
          <p>{waitingForRetry
            ? "服务端已保留当前项目和素材，将自动重试；无需刷新或重新上传。"
            : "页面进度来自服务端持久化阶段；刷新后仍可从同一 Job 恢复。"}</p>
          <div className="analysis-progress"><i style={{ width: `${progress}%` }}></i></div>
          <div className="analysis-percent">{String(progress).padStart(2, "0")}% · {stageLabel}</div>
          <div className="analysis-steps">
            {steps.map((step) => {
              const index = stageOrder.indexOf(step.id);
              const done = currentIndex > index;
              const active = currentIndex === index;
              return (
                <div key={step.label} className={`analysis-step ${done ? "done" : active ? "active" : ""}`}>
                  <span className="step-indicator">{done ? <Icon name="check" size={9} /> : null}</span>
                  <span>{step.label}</span>
                  <small>{done ? "DONE" : active ? "RUN" : "WAIT"}</small>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function StructurePanel({ scenes, activeSceneId, onSelectScene, analysis }) {
  const source = artifactData(analysis, "source_blueprint");
  const providerRun = analysis?.provider_run || null;
  const confidence = Number(source?.hook?.confidence);
  const confidenceLabel = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : "—";
  const duration = Number(source?.duration_sec) || projectDuration(scenes, analysis);
  const shotCount = Array.isArray(source?.shots) ? source.shots.length : 0;
  const pace = source?.pace ? String(source.pace).toUpperCase() : "—";
  return (
    <aside className="structure-panel">
      <div className="panel-heading">
        <div>
          <h3>参考视频结构</h3>
          <p>识别 {shotCount} 个源镜头 · 改编为 {scenes.length} 个场景</p>
        </div>
        <div className="score-ring" aria-label={`Hook 置信度 ${confidenceLabel}`}><span>{confidenceLabel}</span></div>
      </div>
      <div className="structure-summary">
        <div className="summary-cell"><small>源时长</small><strong>{formatTime(duration, duration).slice(0, 5)}</strong></div>
        <div className="summary-cell"><small>镜头</small><strong>{shotCount || "—"} CUTS</strong></div>
        <div className="summary-cell"><small>节奏</small><strong>{pace}</strong></div>
      </div>
      <div className="analysis-evidence-card">
        <small>{providerRun ? `${providerRun.provider} · ${providerRun.model}` : "尚无 Provider 记录"}</small>
        <strong>{source?.hook?.description || "尚未生成可验证的 Hook 分析"}</strong>
        <span>
          {Array.isArray(source?.hook?.evidence) && source.hook.evidence.length > 0
            ? `证据时间：${source.hook.evidence.map((item) => `${Number(item.timestamp_sec || 0).toFixed(2)}s`).join("、")}`
            : "没有证据时间点"}
        </span>
      </div>
      <div className="scene-list">
        {scenes.map((scene, index) => (
          <button key={scene.id} type="button" className={`scene-row ${activeSceneId === scene.id ? "active" : ""}`} onClick={() => onSelectScene(scene)}>
            <MiniSceneArt scene={scene} active={activeSceneId === scene.id} index={index} />
            <span className="scene-row-copy">
              <strong>{scene.label} · {scene.title}</strong>
              <span>{scene.description}</span>
              <small className={`scene-state state-${scene.generation_status}`}>{sceneStatusLabel(scene)} · QC {scene.qc_status || "pending"}</small>
            </span>
            <span className="scene-duration">{scene.duration.toFixed(1)}s</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function PreviewStage({ scenes, activeScene, currentTime, totalDuration, playing, onTogglePlay, onSeek, productImage, previewScale, showSafeArea, onToast }) {
  const progress = (currentTime / totalDuration) * 100;
  const accent = activeScene.accent && activeScene.headline.includes(activeScene.accent) ? activeScene.accent : "";
  const headlinePieces = accent ? activeScene.headline.split(accent) : [activeScene.headline, ""];
  const sceneNumber = scenes.findIndex((scene) => scene.id === activeScene.id) + 1;
  return (
    <main className="stage-panel">
      <div className="stage-toolbar">
        <div className="stage-toolbar-group">
          <button type="button" className="tool-button" onClick={() => onToast("画布已适配", "预览已居中显示为 9:16") }>
            <Icon name="grid" size={14} /> 9:16
          </button>
          <button type="button" className="tool-button square" aria-label="查看证据映射" onClick={() => onToast("源镜头映射", activeScene.sourceShotIds.length ? activeScene.sourceShotIds.join("、") : "该场景没有源镜头引用") }>
            <Icon name="layers" size={14} />
          </button>
        </div>
        <div className="stage-toolbar-group">
          <button type="button" className="tool-button square" aria-label="缩小预览" onClick={() => onToast("缩放可在风格面板调整", "当前预览保持居中")}>−</button>
          <span className="zoom-readout">{previewScale}%</span>
          <button type="button" className="tool-button square" aria-label="放大预览" onClick={() => onToast("缩放可在风格面板调整", "当前预览保持居中")}>＋</button>
        </div>
      </div>
      <div className="stage-canvas" onDoubleClick={() => onTogglePlay()}>
        <div className="phone-preview-wrap" style={{ transform: `scale(${previewScale / 100})` }}>
          <div className="scene-dna" aria-label="视频场景结构">
            {scenes.map((scene) => (
              <span
                key={scene.id}
                className={activeScene.id === scene.id ? "active" : ""}
                style={{ "--scene-flex": scene.duration, "--scene-color": scene.color }}
              ></span>
            ))}
          </div>
          <div className="phone-preview">
            <div className="preview-bg" style={{ background: `linear-gradient(145deg, ${activeScene.color}, #141b29 72%)` }}></div>
            {showSafeArea && <div className="safe-area"></div>}
            {activeScene.storyboardUrl ? (
              <img className="storyboard-preview-image" src={activeScene.storyboardUrl} alt={`场景 ${sceneNumber} 已生成 Storyboard`} />
            ) : (
              <>
                <div className="preview-grid-type">
                  {headlinePieces[0]}{accent && <span className="accent-word">{accent}</span>}{headlinePieces[1]}
                </div>
                <div className="preview-stat">{activeScene.overlay}</div>
                <div className="preview-product"><ProductArt image={productImage} /></div>
                <div className="preview-caption">{activeScene.caption}</div>
              </>
            )}
            <div className="preview-scene-label">SCENE {String(sceneNumber).padStart(2, "0")} · {activeScene.short}</div>
            <div className={`preview-generation-state state-${activeScene.generation_status}`}>{sceneStatusLabel(activeScene)}</div>
            <div className="preview-progress"><i style={{ width: `${progress}%` }}></i></div>
          </div>
        </div>
      </div>
      <div className="stage-controls">
        <div className="control-spacer"></div>
        <button type="button" className="play-button" aria-label={playing ? "暂停" : "播放"} onClick={onTogglePlay}>
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
        <div className="timecode"><strong>{formatTime(currentTime, totalDuration)}</strong> / {formatTime(totalDuration, totalDuration)}</div>
        <button type="button" className="tool-button square" aria-label="静音切换" onClick={() => onToast("预览音量 80%", "已保留人声优先混音") }>
          <Icon name="volume" size={14} />
        </button>
      </div>
    </main>
  );
}

function InspectorPanel({ activeScene, sceneNumber, productCount, productProfile, onUpdateScene, productImage, onUpload, onRegenerate }) {
  return (
    <aside className="inspector-panel">
      <div className="panel-heading">
        <div>
          <h3>场景属性</h3>
          <p>SCENE {String(sceneNumber).padStart(2, "0")} · {activeScene.label} · {sceneStatusLabel(activeScene)}</p>
        </div>
        <button type="button" className="icon-button" aria-label="更多场景操作" onClick={onRegenerate}><Icon name="dots" size={16} /></button>
      </div>
      <div className="inspector-body">
        <section className="property-section">
          <div className="property-title"><span>画面标题</span><span>{activeScene.headline.length}/28</span></div>
          <input className="text-field" value={activeScene.headline} onChange={(event) => onUpdateScene("headline", event.target.value)} />
        </section>
        <section className="property-section">
          <div className="property-title"><span>商品理解</span><span>PRODUCT PROFILE</span></div>
          <div className="product-facts">
            <span><small>类目</small><strong>{productFactText(productProfile, "category")}</strong></span>
            <span><small>材质</small><strong>{productFactText(productProfile, "material")}</strong></span>
            <span><small>形状</small><strong>{productFactText(productProfile, "shape")}</strong></span>
            <span><small>颜色</small><strong>{productFactText(productProfile, "colors")}</strong></span>
          </div>
        </section>
        <section className="property-section">
          <div className="property-title"><span>口播脚本</span><span>{activeScene.duration.toFixed(1)} SEC</span></div>
          <textarea className="text-area" value={activeScene.script} onChange={(event) => onUpdateScene("script", event.target.value)}></textarea>
          <div className="script-note" style={{ marginTop: 8 }}>
            <Icon name="spark" size={13} />
            <span>{activeScene.adaptationReason || "Provider 未返回该场景的改编依据。"}</span>
          </div>
        </section>
        <section className="property-section">
          <div className="property-title"><span>源视频证据</span><span>{activeScene.sourceShotIds.length} SHOTS</span></div>
          <div className="evidence-list">
            {activeScene.sourceShots.length > 0 ? activeScene.sourceShots.map((shot) => (
              <div className="evidence-item" key={shot.shot_id}>
                <strong>{shot.shot_id} · {Number(shot.start_sec).toFixed(2)}–{Number(shot.end_sec).toFixed(2)}s</strong>
                <span>{shot.purpose} · {shot.subject} · {shot.action}</span>
              </div>
            )) : <span className="empty-evidence">没有源镜头映射</span>}
          </div>
        </section>
        <section className="property-section">
          <div className="property-title"><span>商品素材</span><span>{productCount} INPUT</span></div>
          <div className="asset-grid">
            <div className="asset-card selected"><ProductArt image={productImage} /></div>
            <button type="button" className="asset-add" aria-label="添加商品素材" onClick={onUpload}><Icon name="plus" size={17} /></button>
            <button type="button" className="asset-add" aria-label="自动生成场景素材" onClick={onRegenerate}><Icon name="wand" size={16} /></button>
          </div>
        </section>
        <button type="button" className="secondary-button" onClick={onRegenerate}>
          <Icon name="redo" size={15} /> {activeScene.storyboard_asset_id ? "重新生成当前场景" : "生成当前场景"}
        </button>
      </div>
    </aside>
  );
}

function Timeline({ scenes, activeSceneId, currentTime, totalDuration, onSelectScene, onSeek }) {
  const ruler = Array.from({ length: 6 }, (_, index) => (totalDuration * index) / 5);
  const seekFromEvent = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(percent * totalDuration);
  };
  return (
    <section className="timeline-panel" aria-label="视频时间轴">
      <div className="track-labels">
        <div className="track-label"><Icon name="film" size={13} /> 视频结构</div>
        <div className="track-label"><Icon name="subtitles" size={13} /> 字幕</div>
        <div className="track-label"><Icon name="volume" size={13} /> 配音</div>
      </div>
      <div className="timeline-content" onClick={seekFromEvent}>
        <div className="timeline-ruler">
          {ruler.map((mark) => <span className="ruler-mark" key={mark}>{formatTime(mark, totalDuration).slice(0, 5)}</span>)}
        </div>
        <div className="timeline-track">
          {scenes.map((scene) => (
            <button
              key={scene.id}
              type="button"
              className={`clip ${activeSceneId === scene.id ? "selected" : ""}`}
              style={{ flex: scene.duration, "--clip-color": scene.color }}
              onClick={(event) => { event.stopPropagation(); onSelectScene(scene); }}
            >
              <span>{scene.label} · {scene.title}</span>
            </button>
          ))}
        </div>
        <div className="timeline-track">
          {scenes.map((scene) => (
            <button
              key={scene.id}
              type="button"
              className={`clip caption-clip ${activeSceneId === scene.id ? "selected" : ""}`}
              style={{ flex: scene.duration }}
              onClick={(event) => { event.stopPropagation(); onSelectScene(scene); }}
            >
              <span>{scene.caption}</span>
            </button>
          ))}
        </div>
        <div className="timeline-track">
          <div className="clip audio-clip" style={{ flex: 1 }}>
            {AUDIO_BARS.map((height, index) => <i key={index} style={{ "--h": `${Math.min(24, height)}px` }}></i>)}
          </div>
        </div>
        <div className="playhead" style={{ left: `${(currentTime / totalDuration) * 100}%` }}></div>
      </div>
    </section>
  );
}

function EditorScreen({ scenes, activeScene, analysis, totalDuration, productCount, currentTime, playing, productImage, previewScale, showSafeArea, onSelectScene, onTogglePlay, onSeek, onUpdateScene, onUpload, onRegenerate, onToast }) {
  if (!activeScene) {
    return <section className="editor-empty-state"><strong>尚无分镜数据</strong><span>请返回导入页完成分析，工作台不会用演示场景代替真实结果。</span></section>;
  }
  const sceneNumber = scenes.findIndex((scene) => scene.id === activeScene.id) + 1;
  return (
    <section className="editor-screen" data-screen-label="视频重制编辑台">
      <div className="editor-main">
        <StructurePanel scenes={scenes} activeSceneId={activeScene.id} onSelectScene={onSelectScene} analysis={analysis} />
        <PreviewStage
          scenes={scenes}
          activeScene={activeScene}
          currentTime={currentTime}
          totalDuration={totalDuration}
          playing={playing}
          onTogglePlay={onTogglePlay}
          onSeek={onSeek}
          productImage={productImage}
          previewScale={previewScale}
          showSafeArea={showSafeArea}
          onToast={onToast}
        />
        <InspectorPanel activeScene={activeScene} sceneNumber={sceneNumber} productCount={productCount} productProfile={artifactData(analysis, "product_profile")} onUpdateScene={onUpdateScene} productImage={productImage} onUpload={onUpload} onRegenerate={onRegenerate} />
      </div>
      <Timeline scenes={scenes} activeSceneId={activeScene.id} currentTime={currentTime} totalDuration={totalDuration} onSelectScene={onSelectScene} onSeek={onSeek} />
    </section>
  );
}

function GenerateModal({ progress }) {
  const colors = ["#d95e42", "#3b6486", "#3f8078", "#655b91", "#9b5671", "#a9793c"];
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="render-title">
      <div className="generate-modal">
        <div className="modal-head">
          <div>
            <h3 id="render-title">正在生成 Storyboard</h3>
            <p>按当前 Blueprint 重新组织分镜字段与模型中立 Prompt。</p>
          </div>
          <span className="project-state">720 × 1280</span>
        </div>
        <div className="render-visual">
          <div className="render-frames">
            {colors.map((color, index) => <i key={color} style={{ "--c": color, "--d": `${index * 0.09}s` }}></i>)}
          </div>
          <div className="render-line"><i style={{ width: `${progress}%` }}></i></div>
        </div>
        <div className="render-meta"><span>STORYBOARD · LOCAL</span><strong>{progress}%</strong></div>
      </div>
    </div>
  );
}

function Toast({ title, message }) {
  return (
    <div className="toast" role="status">
      <span className="toast-icon"><Icon name="check" size={14} /></span>
      <span><strong>{title}</strong><span>{message}</span></span>
    </div>
  );
}

function AccountMenu({ onClose, onToast, providerInfo }) {
  return (
    <div className="account-menu">
      <div className="account-summary"><strong>本地运营账户</strong><span>Tibao 视频工作台 · Phase B</span></div>
      <button type="button" onClick={() => { onToast("Provider 状态", providerInfo?.provider === "openai" ? `真实分析：${providerInfo.analysis_model || "已配置模型"}` : "当前使用 Fixture/Fake，不能代表真实视频分析"); onClose(); }}><Icon name="folder" size={14} /> 查看空间说明</button>
      <button type="button" onClick={() => { openTweaks(); onClose(); }}><Icon name="settings" size={14} /> 原型风格设置</button>
    </div>
  );
}

function App() {
  const [tweaks, setTweak] = useTweaks(window.TWEAK_DEFAULTS);
  const linkedProduct = React.useMemo(() => readTibaoProduct(), []);
  const [screen, setScreen] = React.useState("setup");
  const [url, setUrl] = React.useState("");
  const [referenceVideo, setReferenceVideo] = React.useState(null);
  const [productFile, setProductFile] = React.useState(null);
  const [productImage, setProductImage] = React.useState("");
  const [productFileName, setProductFileName] = React.useState("");
  const [hasProduct, setHasProduct] = React.useState(false);
  const [language, setLanguage] = React.useState("ms-MY");
  const [length, setLength] = React.useState("auto");
  const [formError, setFormError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [project, setProject] = React.useState(null);
  const [projectAssets, setProjectAssets] = React.useState([]);
  const [analysis, setAnalysis] = React.useState(null);
  const [providerInfo, setProviderInfo] = React.useState({ provider: "unknown" });
  const [analysisJobId, setAnalysisJobId] = React.useState("");
  const [analysisStage, setAnalysisStage] = React.useState("queued");
  const [persistedScenes, setPersistedScenes] = React.useState([]);
  const [currentTime, setCurrentTime] = React.useState(() => readLocal("recut:time", 0));
  const [playing, setPlaying] = React.useState(false);
  const [sceneEdits, setSceneEdits] = React.useState({});
  const [toast, setToast] = React.useState(null);
  const [accountOpen, setAccountOpen] = React.useState(false);
  const [rendering, setRendering] = React.useState(false);
  const [renderProgress, setRenderProgress] = React.useState(0);
  const [generated, setGenerated] = React.useState(false);
  const fileRef = React.useRef(null);
  const videoFileRef = React.useRef(null);
  const toastTimer = React.useRef(null);
  const [referenceVideoPreview, setReferenceVideoPreview] = React.useState("");

  const scenes = React.useMemo(() => {
    return projectScenes(persistedScenes, analysis)
      .map((scene) => ({ ...scene, ...(sceneEdits[scene.id] || {}) }));
  }, [persistedScenes, analysis, sceneEdits]);
  const totalDuration = React.useMemo(() => projectDuration(scenes, analysis), [scenes, analysis]);
  const activeScene = scenes.find((scene) => currentTime >= scene.start && currentTime < scene.end) || scenes[scenes.length - 1];
  const productCount = artifactData(analysis, "product_profile")?.image_asset_ids?.length
    || projectAssets.filter((asset) => asset.role === "product_image").length;
  const storedSource = projectAssets.find((asset) => asset.role === "source_video" && asset.status === "ready");
  const sourcePreview = referenceVideoPreview || assetContentUrl(storedSource?.id);

  const showToast = React.useCallback((title, message) => {
    window.clearTimeout(toastTimer.current);
    setToast({ title, message });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    videoApi("/health").then((health) => {
      if (!cancelled) setProviderInfo(health);
    }).catch(() => {
      if (!cancelled) setProviderInfo({ provider: "unknown" });
    });
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    if (!referenceVideo) {
      setReferenceVideoPreview("");
      return undefined;
    }
    const preview = URL.createObjectURL(referenceVideo);
    setReferenceVideoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [referenceVideo]);

  React.useEffect(() => {
    if (linkedProduct) return undefined;
    const savedProjectId = readLocal("recut:project-id", "");
    if (!savedProjectId) return undefined;
    let cancelled = false;
    Promise.all([
      videoApi(`/projects/${savedProjectId}`),
      videoApi(`/projects/${savedProjectId}/scenes`)
    ]).then(([aggregate, sceneResponse]) => {
      if (cancelled) return;
      setProject(aggregate.project);
      setProjectAssets(aggregate.assets || []);
      setAnalysis(aggregate.analysis || null);
      const productAsset = (aggregate.assets || []).find((asset) => asset.role === "product_image" && asset.status === "ready");
      if (productAsset) {
        setProductImage(assetContentUrl(productAsset.id));
        setProductFileName("已上传商品素材");
        setHasProduct(true);
      }
      const restoredScenes = sceneResponse.scenes || [];
      if (restoredScenes.length > 0) {
        setPersistedScenes(restoredScenes);
        setGenerated(restoredScenes.every((scene) => Boolean(scene.storyboard_asset_id)));
        setScreen("editor");
        return;
      }
      const running = (aggregate.jobs || []).find((job) => ["queued", "running", "retry_wait"].includes(job.status));
      if (running) {
        setAnalysisJobId(running.id);
        setAnalysisStage(running.progress_stage || running.status);
        setScreen("analyzing");
      }
    }).catch(() => {
      localStorage.removeItem("recut:project-id");
    });
    return () => { cancelled = true; };
  }, [linkedProduct]);

  React.useEffect(() => {
    writeLocal("recut:time", Number(currentTime.toFixed(2)));
  }, [currentTime]);

  React.useEffect(() => {
    if (currentTime >= totalDuration) setCurrentTime(Math.max(0, totalDuration - 0.01));
  }, [currentTime, totalDuration]);

  React.useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      setCurrentTime((time) => {
        const next = time + 0.08;
        if (next >= totalDuration) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing, totalDuration]);

  React.useEffect(() => {
    if (screen !== "analyzing" || !analysisJobId) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try {
        const response = await videoApi(`/jobs/${analysisJobId}`);
        if (cancelled) return;
        const job = response.job;
        setAnalysisStage(job.progress_stage || job.status || "queued");
        if (job.status === "succeeded") {
          const [aggregate, sceneResponse] = await Promise.all([
            videoApi(`/projects/${job.project_id}`),
            videoApi(`/projects/${job.project_id}/scenes`)
          ]);
          if (cancelled) return;
          setProject(aggregate.project);
          setProjectAssets(aggregate.assets || []);
          setAnalysis(aggregate.analysis || null);
          const analyzedScenes = sceneResponse.scenes || [];
          setPersistedScenes(analyzedScenes);
          setGenerated(analyzedScenes.every((scene) => Boolean(scene.storyboard_asset_id)));
          setCurrentTime(0);
          setScreen("editor");
          showToast("结构拆解完成", `服务端已持久化 ${(sceneResponse.scenes || []).length} 个可编辑 Storyboard`);
          return;
        }
        if (["failed", "cancelled", "superseded"].includes(job.status)) {
          setScreen("setup");
          setFormError(job.error_message || `分析作业进入 ${job.status} 状态，请重试。`);
          return;
        }
        timer = window.setTimeout(poll, 1_500);
      } catch (error) {
        if (!cancelled) {
          setScreen("setup");
          setFormError(error.message || "读取分析作业失败");
        }
      }
    };
    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [screen, analysisJobId, showToast]);

  React.useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    if (productImage.startsWith("blob:")) URL.revokeObjectURL(productImage);
  }, [productImage]);

  const uploadAsset = async (projectId, role, file) => {
    const contentType = file.type || (role === "source_video" ? "video/mp4" : "image/png");
    const session = await videoApi(`/projects/${projectId}/uploads`, {
      method: "POST",
      headers: writeHeaders(),
      body: JSON.stringify({
        role,
        content_type: contentType,
        bytes: file.size
      })
    });
    const uploadResponse = await fetch(session.url, {
      method: "PUT",
      headers: session.required_headers,
      body: file
    });
    const uploadBody = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok) {
      throw new Error(uploadBody?.error?.message || uploadBody?.error || `素材上传失败：${uploadResponse.status}`);
    }
    await videoApi(`/uploads/${session.upload_id}/complete`, { method: "POST" });
  };

  const handleAnalyze = async () => {
    if (!url.trim() && !referenceVideo) {
      setFormError("请粘贴参考视频链接或上传本地 MP4。");
      return;
    }
    if (url.trim() && !/^https?:\/\//i.test(url.trim())) {
      setFormError("链接需要以 http:// 或 https:// 开头。");
      return;
    }
    if (url.trim() && !referenceVideo) {
      setFormError("当前版本会校验链接但不会下载媒体，请上传你有权使用的本地 MP4 后继续。");
      return;
    }
    if (!hasProduct || !productFile) {
      setFormError("请至少上传一张商品图片，或载入演示素材。");
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      const catalogContext = linkedProduct ? {
        shop_id: linkedProduct.shopId,
        product_id: linkedProduct.id,
        title: linkedProduct.title,
        category: linkedProduct.category,
        brand: linkedProduct.brandName,
        shop_region: linkedProduct.shopRegion
      } : undefined;
      const created = await videoApi("/projects", {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify({
          name: linkedProduct?.title || `ReCut ${new Date().toLocaleDateString()}`,
          catalog_context: catalogContext,
          target_market: linkedProduct?.shopRegion || "MY",
          language,
          target_duration_sec: length === "auto" ? null : Number(length),
          similarity_score: 60
        })
      });
      setProject(created.project);
      writeLocal("recut:project-id", created.project.id);
      await uploadAsset(created.project.id, "source_video", referenceVideo);
      await uploadAsset(created.project.id, "product_image", productFile);
      const refreshed = await videoApi(`/projects/${created.project.id}`);
      setProject(refreshed.project);
      setProjectAssets(refreshed.assets || []);
      setAnalysis(refreshed.analysis || null);
      const run = await videoApi(`/projects/${created.project.id}/analysis-runs`, {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify({
          expected_project_revision: refreshed.project.revision,
          rights_acknowledgement: {
            accepted: true,
            policy_version: "2026-08-15"
          }
        })
      });
      setAnalysisJobId(run.job.id);
      setAnalysisStage(run.job.progress_stage || "queued");
      setScreen("analyzing");
    } catch (error) {
      setFormError(error.message || "创建视频分析作业失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemo = () => {
    const demoVideo = fileFromBase64(DEMO_VIDEO_BASE64, "recut-phase-b-demo.mp4", "video/mp4");
    const demoImage = fileFromBase64(DEMO_IMAGE_BASE64, "recut-fixture-product.png", "image/png");
    setUrl("");
    setReferenceVideo(demoVideo);
    setProductFile(demoImage);
    setProductImage(URL.createObjectURL(demoImage));
    setProductFileName("recut-fixture-product.png");
    setHasProduct(true);
    setFormError("");
    showToast("Phase B fixture 已载入", "这是可被 FFprobe/FFmpeg 真实解码的 3 秒无音轨 MP4；ASR 会明确跳过");
  };

  const handleVideoFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isMp4 = file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
    if (!isMp4) {
      showToast("文件格式不支持", "参考视频目前只接受 MP4");
      event.target.value = "";
      return;
    }
    if (file.size > 150 * 1024 * 1024) {
      showToast("参考视频过大", "Alpha 单个视频不能超过 150 MB");
      event.target.value = "";
      return;
    }
    setReferenceVideo(file);
    setUrl("");
    setFormError("");
    showToast("参考视频已加入", `${file.name} 会在开始分析时上传到本地私有目录`);
    event.target.value = "";
  };

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("文件格式不支持", "请选择 PNG、JPG 或 WebP 图片");
      return;
    }
    if (productImage.startsWith("blob:")) URL.revokeObjectURL(productImage);
    setProductFile(file);
    setProductImage(URL.createObjectURL(file));
    setProductFileName(file.name);
    setHasProduct(true);
    setFormError("");
    showToast("商品图片已加入", `${file.name} 会作为项目输入上传并记录校验和`);
    event.target.value = "";
  };

  const navigate = (target) => {
    setAccountOpen(false);
    if (target === "home") {
      setPlaying(false);
      setScreen("setup");
    } else if (target === "editor") {
      if (screen === "editor") showToast("已经在生成工作台", `当前项目共有 ${scenes.length} 个真实场景`);
      else showToast("先完成结构分析", "导入参考视频和商品后即可进入工作台");
    } else if (target === "assets") {
      showToast("素材库原型", "下一版可扩展为独立的品牌资产中心");
    } else if (target === "history") {
      showToast("历史版本", generated ? "当前包含持久化的 Blueprint 与 Storyboard revision" : "生成分镜后会保存版本");
    }
  };

  const selectScene = (scene) => {
    setPlaying(false);
    setCurrentTime(Math.min(totalDuration - 0.01, scene.start + 0.03));
  };

  const updateScene = (field, value) => {
    if (!activeScene) return;
    setSceneEdits((edits) => ({ ...edits, [activeScene.id]: { ...(edits[activeScene.id] || {}), [field]: value } }));
  };

  const waitForJobs = async (jobIds) => {
    const pending = new Set(jobIds);
    for (let attempt = 0; attempt < 300 && pending.size > 0; attempt += 1) {
      const states = await Promise.all([...pending].map((jobId) => videoApi(`/jobs/${jobId}`)));
      for (const response of states) {
        if (response.job.status === "succeeded") pending.delete(response.job.id);
        else if (["failed", "cancelled", "superseded"].includes(response.job.status)) {
          throw new Error(response.job.error_message || `作业 ${response.job.id} ${response.job.status}`);
        }
      }
      setRenderProgress(Math.round(((jobIds.length - pending.size) / Math.max(1, jobIds.length)) * 100));
      if (pending.size > 0) await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    if (pending.size > 0) throw new Error("等待服务端作业超时，请稍后从项目恢复");
  };

  const refreshProjectScenes = async () => {
    if (!project?.id) return [];
    const [aggregate, sceneResponse] = await Promise.all([
      videoApi(`/projects/${project.id}`),
      videoApi(`/projects/${project.id}/scenes`)
    ]);
    const nextScenes = sceneResponse.scenes || [];
    setProject(aggregate.project);
    setProjectAssets(aggregate.assets || []);
    setAnalysis(aggregate.analysis || null);
    setPersistedScenes(nextScenes);
    setGenerated(nextScenes.length > 0 && nextScenes.every((scene) => Boolean(scene.storyboard_asset_id)));
    return nextScenes;
  };

  const handleGenerateStoryboards = async () => {
    if (!project?.id || rendering) return;
    setRendering(true);
    setRenderProgress(0);
    try {
      const aggregate = await videoApi(`/projects/${project.id}`);
      const batch = await videoApi(`/projects/${project.id}/storyboard-runs`, {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify({ expected_project_revision: aggregate.project.revision })
      });
      await waitForJobs((batch.jobs || []).map((job) => job.id));
      await refreshProjectScenes();
      setGenerated(true);
      showToast("分镜生成完成", "逐镜图片、QC 与版本已由服务端持久化；不会生成 MP4");
    } catch (error) {
      showToast("分镜生成未完成", error.message || "请稍后重试");
    } finally {
      setRendering(false);
    }
  };

  const handleRegenerateScene = async () => {
    if (!project?.id || !activeScene || rendering) return;
    setRendering(true);
    setRenderProgress(0);
    try {
      let revision = activeScene.revision;
      const edits = sceneEdits[activeScene.id] || {};
      if (Object.keys(edits).length > 0) {
        const saved = await videoApi(`/projects/${project.id}/scenes/${activeScene.id}`, {
          method: "PATCH",
          headers: { ...writeHeaders(), "if-match": `"${revision}"` },
          body: JSON.stringify(edits)
        });
        revision = saved.scene.revision;
      }
      const run = await videoApi(`/projects/${project.id}/scenes/${activeScene.id}/image-runs`, {
        method: "POST",
        headers: { ...writeHeaders(), "if-match": `"${revision}"` },
        body: JSON.stringify({ regeneration_scope: "rebuild_from_current_fields" })
      });
      await waitForJobs([run.job.id]);
      await refreshProjectScenes();
      setSceneEdits((editsByScene) => ({ ...editsByScene, [activeScene.id]: {} }));
      showToast("当前场景已重生成", "其他场景的图片、Prompt 和 revision 保持不变");
    } catch (error) {
      showToast("单镜重生成失败", error.message || "请稍后重试");
    } finally {
      setRendering(false);
    }
  };

  const handleExport = async () => {
    if (!project?.id) return;
    try {
      const result = await videoApi(`/projects/${project.id}/exports`, {
        method: "POST",
        headers: writeHeaders(),
        body: JSON.stringify({ kind: "draft" })
      });
      setRendering(true);
      setRenderProgress(0);
      await waitForJobs([result.job.id]);
      const exported = await videoApi(`/exports/${result.export.id}`);
      if (!exported.download_url) throw new Error("导出已完成但下载地址尚未就绪");
      const anchor = document.createElement("a");
      anchor.href = exported.download_url;
      anchor.download = "";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      showToast("Prompt 包已生成", "ZIP 包含版本化 JSON、Markdown、Manifest 哈希与现有 Storyboard 图片");
    } catch (error) {
      showToast("导出失败", error.message || "项目内容仍已保存，可稍后重试");
    } finally {
      setRendering(false);
    }
  };

  const palette = Array.isArray(tweaks.palette) ? tweaks.palette : window.TWEAK_DEFAULTS.palette;
  const shellStyle = {
    "--accent": palette[0],
    "--accent-rgb": hexToRgb(palette[0]),
    "--ink": palette[1],
    "--signal": palette[2],
    "--signal-rgb": hexToRgb(palette[2])
  };

  return (
    <div className={`app-shell ${tweaks.density === "紧凑" ? "compact-density" : ""}`} style={shellStyle}>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={handleFile} />
      <input ref={videoFileRef} type="file" accept="video/mp4,.mp4" hidden onChange={handleVideoFile} />
      <Sidebar screen={screen} onNavigate={navigate} onAccount={() => setAccountOpen((open) => !open)} />
      <Topbar
        screen={screen}
        generated={generated}
        projectStatus={screen === "analyzing" ? analysisStage : project?.status}
        onBack={() => { setPlaying(false); setScreen("setup"); }}
        onGenerate={handleGenerateStoryboards}
        onExport={handleExport}
        onToast={showToast}
      />
      <div className="workspace">
        {screen === "setup" && (
          <SetupScreen
            url={url}
            setUrl={(value) => { setUrl(value); if (value.trim()) setReferenceVideo(null); }}
            referenceVideoName={referenceVideo?.name || ""}
            onVideoUpload={() => videoFileRef.current?.click()}
            onRemoveVideo={() => setReferenceVideo(null)}
            linkedProduct={linkedProduct}
            productImage={productImage}
            productFileName={productFileName}
            hasProduct={hasProduct}
            onUpload={() => fileRef.current?.click()}
            onRemoveProduct={() => { if (productImage.startsWith("blob:")) URL.revokeObjectURL(productImage); setProductFile(null); setProductImage(""); setProductFileName(""); setHasProduct(false); }}
            onDemo={handleDemo}
            onAnalyze={handleAnalyze}
            submitting={submitting}
            formError={formError}
            language={language}
            setLanguage={setLanguage}
            length={length}
            setLength={setLength}
            providerInfo={providerInfo}
          />
        )}
        {screen === "analyzing" && <AnalysisScreen stage={analysisStage} sourcePreview={sourcePreview} providerName={providerInfo.provider} />}
        {screen === "editor" && (
          <EditorScreen
            scenes={scenes}
            activeScene={activeScene}
            analysis={analysis}
            totalDuration={totalDuration}
            productCount={productCount}
            currentTime={currentTime}
            playing={playing}
            productImage={productImage}
            previewScale={tweaks.previewScale}
            showSafeArea={tweaks.showSafeArea}
            onSelectScene={selectScene}
            onTogglePlay={() => setPlaying((value) => !value)}
            onSeek={(time) => setCurrentTime(Math.max(0, Math.min(totalDuration - 0.01, time)))}
            onUpdateScene={updateScene}
            onUpload={() => fileRef.current?.click()}
            onRegenerate={handleRegenerateScene}
            onToast={showToast}
          />
        )}
      </div>
      {accountOpen && <AccountMenu onClose={() => setAccountOpen(false)} onToast={showToast} providerInfo={providerInfo} />}
      {rendering && <GenerateModal progress={renderProgress} />}
      {toast && <Toast title={toast.title} message={toast.message} />}
      <TweaksPanel title="风格">
        <TweakSection label="视觉方向" />
        <TweakColor
          label="配色"
          value={tweaks.palette}
          options={[
            ["#ff6846", "#101522", "#60e5c8"],
            ["#f0b94a", "#172033", "#78a7ff"],
            ["#d88cff", "#15121f", "#8af0b7"]
          ]}
          onChange={(value) => setTweak("palette", value)}
        />
        <TweakRadio label="界面密度" value={tweaks.density} options={["紧凑", "舒展"]} onChange={(value) => setTweak("density", value)} />
        <TweakSection label="视频预览" />
        <TweakSlider label="预览缩放" value={tweaks.previewScale} min={82} max={108} step={2} unit="%" onChange={(value) => setTweak("previewScale", value)} />
        <TweakToggle label="显示安全区" value={tweaks.showSafeArea} onChange={(value) => setTweak("showSafeArea", value)} />
        <TweakSuggestionBar
          suggestions={["让预览更突出", "尝试更明亮的配色", "把时间轴做紧凑一些"]}
          placeholder="描述你想调整的风格…"
        />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
