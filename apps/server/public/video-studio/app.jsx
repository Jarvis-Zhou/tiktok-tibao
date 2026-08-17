const SCENES = [
  {
    id: 1,
    short: "HOOK",
    label: "钩子",
    title: "反常识开场",
    description: "先指出错误习惯，制造信息缺口",
    duration: 2.6,
    color: "#d95e42",
    headline: "别再把精华直接抹上脸",
    accent: "直接抹",
    overlay: "停留峰值 · 0.8s",
    caption: "大多数人第一步就做错了",
    script: "别再把精华直接抹上脸，大多数人第一步就做错了。"
  },
  {
    id: 2,
    short: "PAIN",
    label: "痛点",
    title: "放大真实困扰",
    description: "用具体结果替代泛泛的问题描述",
    duration: 3.2,
    color: "#3b6486",
    headline: "越补水，底妆反而越斑驳？",
    accent: "越斑驳",
    overlay: "问题共鸣 · 3 连击",
    caption: "不是缺水，是屏障留不住水",
    script: "越补水，底妆反而越斑驳？问题不是缺水，而是屏障留不住水。"
  },
  {
    id: 3,
    short: "REVEAL",
    label: "亮相",
    title: "商品第一次露出",
    description: "先给解决机制，再显示产品名称",
    duration: 3.8,
    color: "#3f8078",
    headline: "先锁水，再让皮肤吃进去",
    accent: "先锁水",
    overlay: "商品露出 · 58% 画面",
    caption: "GlowDrop 双相屏障精华",
    script: "先锁住水分，再让皮肤慢慢吃进去。这瓶是我最近在用的 GlowDrop。"
  },
  {
    id: 4,
    short: "DEMO",
    label: "演示",
    title: "三步使用演示",
    description: "动作跟随节拍，每个步骤只讲一件事",
    duration: 5.2,
    color: "#655b91",
    headline: "摇匀 · 按压 · 轻拍 10 秒",
    accent: "10 秒",
    overlay: "动作节拍 · 116 BPM",
    caption: "两泵就够，别反复揉搓",
    script: "摇匀、按压两泵，再轻拍十秒。别反复揉搓，让它自己成膜。"
  },
  {
    id: 5,
    short: "PROOF",
    label: "证据",
    title: "即时结果对比",
    description: "用近景质感与时间标签建立可信度",
    duration: 6,
    color: "#9b5671",
    headline: "上妆 8 小时，鼻翼还是服帖",
    accent: "8 小时",
    overlay: "Before / After · 同光线",
    caption: "下午 6:40 实拍，没有补妆",
    script: "这是上妆八小时后的鼻翼，下午六点四十实拍，中间没有补妆。"
  },
  {
    id: 6,
    short: "CTA",
    label: "收口",
    title: "低压力行动号召",
    description: "复述核心收益，引导查看商品详情",
    duration: 4.2,
    color: "#a9793c",
    headline: "想要服帖底妆，先把屏障养好",
    accent: "先养好",
    overlay: "CTA · 商品锚点",
    caption: "点开商品卡，先看你的肤质适不适合",
    script: "想要服帖底妆，先把屏障养好。点开商品卡，看看你的肤质适不适合。"
  }
];

const TOTAL_DURATION = SCENES.reduce((sum, scene) => sum + scene.duration, 0);
let cursor = 0;
const TIMED_SCENES = SCENES.map((scene) => {
  const timed = { ...scene, start: cursor, end: cursor + scene.duration };
  cursor += scene.duration;
  return timed;
});

const AUDIO_BARS = [8, 16, 10, 22, 14, 28, 18, 9, 24, 15, 30, 20, 11, 26, 17, 8, 21, 13, 27, 16, 9, 23, 12, 29, 18, 10, 25, 14, 20, 8, 24, 16, 11, 28, 18, 9, 22, 13, 26, 15, 10, 21, 12, 24, 16, 9, 19, 12, 22, 14, 8, 18, 11, 20, 13, 8, 16, 10, 18, 12];
const SCENE_COLORS = ["#d95e42", "#3b6486", "#3f8078", "#655b91", "#9b5671", "#a9793c"];

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

function writeHeaders() {
  return {
    "content-type": "application/json",
    "idempotency-key": crypto.randomUUID()
  };
}

function projectScenes(items) {
  let start = 0;
  return items.map((scene, index) => {
    const duration = Number(scene.duration_sec) || 1;
    const projected = {
      ...scene,
      duration,
      start,
      end: start + duration,
      color: SCENE_COLORS[index % SCENE_COLORS.length]
    };
    start += duration;
    return projected;
  });
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

function formatTime(seconds) {
  const safe = Math.max(0, Math.min(TOTAL_DURATION, seconds));
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

function SetupScreen({ url, setUrl, referenceVideoName, onVideoUpload, onRemoveVideo, linkedProduct, productImage, productFileName, hasProduct, onUpload, onRemoveProduct, onDemo, onAnalyze, submitting, formError, language, setLanguage, length, setLength }) {
  return (
    <section className="setup-screen" data-screen-label="新建重制项目">
      <div className="setup-wrap">
        <div className="setup-copy">
          <div className="eyebrow">Viral structure transfer</div>
          <h1>把爆款拆成一条<br /><span>可重做的时间线</span></h1>
          <p className="setup-lede">
            导入参考视频和商品素材。ReCut 会识别钩子、节奏、口播与商品露出时机，再把这套结构改写成你的版本。
          </p>
          <div className="prototype-notice"><strong>Phase A 已连接本地服务</strong><span>素材、项目和作业状态会真实持久化；当前使用 deterministic Fake Provider，只生成 Storyboard，不生成 MP4。</span></div>
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
                        <span>{productFileName || "glowdrop-main.png"}</span>
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

function AnalysisScreen({ stage }) {
  const steps = [
    { id: "starting", label: "领取分析作业" },
    { id: "reading_inputs", label: "校验素材与项目快照" },
    { id: "fake_provider", label: "生成 Source / Product / Adapted Blueprint" },
    { id: "validating_output", label: "校验并持久化 Storyboard" }
  ];
  const stageOrder = ["queued", "starting", "reading_inputs", "fake_provider", "validating_output", "completed"];
  const currentIndex = Math.max(0, stageOrder.indexOf(stage));
  const progress = Math.round((currentIndex / (stageOrder.length - 1)) * 100);
  return (
    <section className="analysis-screen" data-screen-label="视频结构分析">
      <div className="analysis-grid"></div>
      <div className="analysis-card">
        <div className="analysis-video">
          <ReferenceFrame playing={true} />
          <div className="scan-line"></div>
        </div>
        <div className="analysis-copy">
          <h2>正在读取爆款 DNA</h2>
          <p>页面进度来自服务端持久化阶段；刷新后仍可从同一 Job 恢复。</p>
          <div className="analysis-progress"><i style={{ width: `${progress}%` }}></i></div>
          <div className="analysis-percent">{String(progress).padStart(2, "0")}% · {String(stage || "queued").toUpperCase()}</div>
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

function StructurePanel({ scenes, activeSceneId, onSelectScene }) {
  return (
    <aside className="structure-panel">
      <div className="panel-heading">
        <div>
          <h3>爆款结构</h3>
          <p>已识别 6 个说服节点</p>
        </div>
        <div className="score-ring" aria-label="结构置信度 92%"><span>92%</span></div>
      </div>
      <div className="structure-summary">
        <div className="summary-cell"><small>时长</small><strong>00:25</strong></div>
        <div className="summary-cell"><small>镜头</small><strong>14 CUTS</strong></div>
        <div className="summary-cell"><small>节奏</small><strong>FAST</strong></div>
      </div>
      <div className="scene-list">
        {scenes.map((scene) => (
          <button key={scene.id} type="button" className={`scene-row ${activeSceneId === scene.id ? "active" : ""}`} onClick={() => onSelectScene(scene)}>
            <MiniSceneArt scene={scene} active={activeSceneId === scene.id} />
            <span className="scene-row-copy">
              <strong>{scene.label} · {scene.title}</strong>
              <span>{scene.description}</span>
            </span>
            <span className="scene-duration">{scene.duration.toFixed(1)}s</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function PreviewStage({ scenes, activeScene, currentTime, playing, onTogglePlay, onSeek, productImage, previewScale, showSafeArea, onToast }) {
  const progress = (currentTime / TOTAL_DURATION) * 100;
  const headlinePieces = activeScene.headline.split(activeScene.accent);
  return (
    <main className="stage-panel">
      <div className="stage-toolbar">
        <div className="stage-toolbar-group">
          <button type="button" className="tool-button" onClick={() => onToast("画布已适配", "预览已居中显示为 9:16") }>
            <Icon name="grid" size={14} /> 9:16
          </button>
          <button type="button" className="tool-button square" aria-label="显示图层" onClick={() => onToast("共 8 个图层", "背景、商品、标题、字幕和安全区") }>
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
            <div className={`preview-bg scene-${activeScene.id}`}></div>
            {showSafeArea && <div className="safe-area"></div>}
            <div className="preview-scene-label">SCENE {String(activeScene.id).padStart(2, "0")} · {activeScene.short}</div>
            <div className="preview-grid-type">
              {headlinePieces[0]}<span className="accent-word">{activeScene.accent}</span>{headlinePieces[1]}
            </div>
            <div className="preview-stat">{activeScene.overlay}</div>
            <div className="preview-product"><ProductArt image={productImage} /></div>
            <div className="preview-caption">{activeScene.caption}</div>
            <div className="preview-progress"><i style={{ width: `${progress}%` }}></i></div>
          </div>
        </div>
      </div>
      <div className="stage-controls">
        <div className="control-spacer"></div>
        <button type="button" className="play-button" aria-label={playing ? "暂停" : "播放"} onClick={onTogglePlay}>
          <Icon name={playing ? "pause" : "play"} size={16} />
        </button>
        <div className="timecode"><strong>{formatTime(currentTime)}</strong> / {formatTime(TOTAL_DURATION)}</div>
        <button type="button" className="tool-button square" aria-label="静音切换" onClick={() => onToast("预览音量 80%", "已保留人声优先混音") }>
          <Icon name="volume" size={14} />
        </button>
      </div>
    </main>
  );
}

function InspectorPanel({ activeScene, onUpdateScene, productImage, onUpload, onRegenerate }) {
  return (
    <aside className="inspector-panel">
      <div className="panel-heading">
        <div>
          <h3>场景属性</h3>
          <p>SCENE {String(activeScene.id).padStart(2, "0")} · {activeScene.label}</p>
        </div>
        <button type="button" className="icon-button" aria-label="更多场景操作" onClick={onRegenerate}><Icon name="dots" size={16} /></button>
      </div>
      <div className="inspector-body">
        <section className="property-section">
          <div className="property-title"><span>画面标题</span><span>{activeScene.headline.length}/28</span></div>
          <input className="text-field" value={activeScene.headline} onChange={(event) => onUpdateScene("headline", event.target.value)} />
        </section>
        <section className="property-section">
          <div className="property-title"><span>口播脚本</span><span>{activeScene.duration.toFixed(1)} SEC</span></div>
          <textarea className="text-area" value={activeScene.script} onChange={(event) => onUpdateScene("script", event.target.value)}></textarea>
          <div className="script-note" style={{ marginTop: 8 }}>
            <Icon name="spark" size={13} />
            <span>这句保持“先指出误区，再给出解释”的结构，但已替换原视频表达。</span>
          </div>
        </section>
        <section className="property-section">
          <div className="property-title"><span>配音</span><span>AI VOICE</span></div>
          <div className="voice-row">
            <span className="voice-avatar">AN</span>
            <span className="voice-copy"><strong>安然 · 自然种草</strong><span>语速 1.08× · 情绪轻快</span></span>
            <span className="wave-mini" aria-hidden="true">
              {[8, 15, 24, 12, 20, 9, 17].map((height, index) => <i key={index} style={{ "--h": `${height}px` }}></i>)}
            </span>
          </div>
        </section>
        <section className="property-section">
          <div className="property-title"><span>商品素材</span><span>1 / 8</span></div>
          <div className="asset-grid">
            <div className="asset-card selected"><ProductArt image={productImage} /></div>
            <button type="button" className="asset-add" aria-label="添加商品素材" onClick={onUpload}><Icon name="plus" size={17} /></button>
            <button type="button" className="asset-add" aria-label="自动生成场景素材" onClick={onRegenerate}><Icon name="wand" size={16} /></button>
          </div>
        </section>
        <button type="button" className="secondary-button" onClick={onRegenerate}>
          <Icon name="redo" size={15} /> 重新生成当前场景
        </button>
      </div>
    </aside>
  );
}

function Timeline({ scenes, activeSceneId, currentTime, onSelectScene, onSeek }) {
  const ruler = [0, 5, 10, 15, 20, 25];
  const seekFromEvent = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    onSeek(percent * TOTAL_DURATION);
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
          {ruler.map((mark) => <span className="ruler-mark" key={mark}>{String(mark).padStart(2, "0")}:00</span>)}
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
        <div className="playhead" style={{ left: `${(currentTime / TOTAL_DURATION) * 100}%` }}></div>
      </div>
    </section>
  );
}

function EditorScreen({ scenes, activeScene, currentTime, playing, productImage, previewScale, showSafeArea, onSelectScene, onTogglePlay, onSeek, onUpdateScene, onUpload, onRegenerate, onToast }) {
  return (
    <section className="editor-screen" data-screen-label="视频重制编辑台">
      <div className="editor-main">
        <StructurePanel scenes={scenes} activeSceneId={activeScene.id} onSelectScene={onSelectScene} />
        <PreviewStage
          scenes={scenes}
          activeScene={activeScene}
          currentTime={currentTime}
          playing={playing}
          onTogglePlay={onTogglePlay}
          onSeek={onSeek}
          productImage={productImage}
          previewScale={previewScale}
          showSafeArea={showSafeArea}
          onToast={onToast}
        />
        <InspectorPanel activeScene={activeScene} onUpdateScene={onUpdateScene} productImage={productImage} onUpload={onUpload} onRegenerate={onRegenerate} />
      </div>
      <Timeline scenes={scenes} activeSceneId={activeScene.id} currentTime={currentTime} onSelectScene={onSelectScene} onSeek={onSeek} />
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

function AccountMenu({ onClose, onToast }) {
  return (
    <div className="account-menu">
      <div className="account-summary"><strong>本地运营账户</strong><span>Tibao 视频工作台 · Phase A</span></div>
      <button type="button" onClick={() => { onToast("本地 Alpha", "当前使用 Fake Provider，但项目、素材、Job 和额度都是真实台账"); onClose(); }}><Icon name="folder" size={14} /> 查看空间说明</button>
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

  const scenes = React.useMemo(() => {
    const source = persistedScenes.length > 0 ? persistedScenes : TIMED_SCENES;
    return source.map((scene) => ({ ...scene, ...(sceneEdits[scene.id] || {}) }));
  }, [persistedScenes, sceneEdits]);
  const activeScene = scenes.find((scene) => currentTime >= scene.start && currentTime < scene.end) || scenes[scenes.length - 1];

  const showToast = React.useCallback((title, message) => {
    window.clearTimeout(toastTimer.current);
    setToast({ title, message });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

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
      const restoredScenes = projectScenes(sceneResponse.scenes || []);
      if (restoredScenes.length > 0) {
        setPersistedScenes(restoredScenes);
        setGenerated(true);
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
    if (!playing) return undefined;
    const timer = window.setInterval(() => {
      setCurrentTime((time) => {
        const next = time + 0.08;
        if (next >= TOTAL_DURATION) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, 80);
    return () => window.clearInterval(timer);
  }, [playing]);

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
          setPersistedScenes(projectScenes(sceneResponse.scenes || []));
          setGenerated(true);
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
        timer = window.setTimeout(poll, 450);
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

  React.useEffect(() => {
    if (!rendering) return undefined;
    setRenderProgress(0);
    const timer = window.setInterval(() => {
      setRenderProgress((value) => {
        const next = Math.min(100, value + (value < 70 ? 5 : 2));
        if (next === 100) {
          window.clearInterval(timer);
          window.setTimeout(() => {
            setRendering(false);
            setGenerated(true);
            showToast("分镜生成完成", "当前输出为 Storyboard 与模型中立 Prompt，不会生成 MP4");
          }, 360);
        }
        return next;
      });
    }, 130);
    return () => window.clearInterval(timer);
  }, [rendering, showToast]);

  React.useEffect(() => () => {
    window.clearTimeout(toastTimer.current);
    if (productImage) URL.revokeObjectURL(productImage);
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
      setFormError("Phase A 会校验链接但不会下载媒体，请上传本地 MP4 后继续。");
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
    const demoVideo = new File([
      new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0])
    ], "recut-phase-a-demo.mp4", { type: "video/mp4" });
    const demoImage = new File([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
    ], "glowdrop-main.png", { type: "image/png" });
    setUrl("");
    setReferenceVideo(demoVideo);
    setProductFile(demoImage);
    setProductImage("");
    setProductFileName("glowdrop-main.png");
    setHasProduct(true);
    setFormError("");
    showToast("Phase A fixture 已载入", "点击分析后会真实上传、入队并由 Fake Provider 生成分镜");
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
    if (productImage) URL.revokeObjectURL(productImage);
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
      if (screen === "editor") showToast("已经在生成工作台", "当前项目共有 6 个场景");
      else showToast("先完成结构分析", "导入参考视频和商品后即可进入工作台");
    } else if (target === "assets") {
      showToast("素材库原型", "下一版可扩展为独立的品牌资产中心");
    } else if (target === "history") {
      showToast("历史版本", generated ? "当前包含持久化的 Blueprint 与 Storyboard revision" : "生成分镜后会保存版本");
    }
  };

  const selectScene = (scene) => {
    setPlaying(false);
    setCurrentTime(Math.min(TOTAL_DURATION - 0.01, scene.start + 0.03));
  };

  const updateScene = (field, value) => {
    setSceneEdits((edits) => ({ ...edits, [activeScene.id]: { ...(edits[activeScene.id] || {}), [field]: value } }));
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
        onGenerate={() => setRendering(true)}
        onExport={() => showToast("Prompt 包将在 Phase B 开放", "V1 导出 ZIP / Markdown / JSON；不会生成或导出 MP4")}
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
            onRemoveProduct={() => { if (productImage) URL.revokeObjectURL(productImage); setProductFile(null); setProductImage(""); setProductFileName(""); setHasProduct(false); }}
            onDemo={handleDemo}
            onAnalyze={handleAnalyze}
            submitting={submitting}
            formError={formError}
            language={language}
            setLanguage={setLanguage}
            length={length}
            setLength={setLength}
          />
        )}
        {screen === "analyzing" && <AnalysisScreen stage={analysisStage} />}
        {screen === "editor" && (
          <EditorScreen
            scenes={scenes}
            activeScene={activeScene}
            currentTime={currentTime}
            playing={playing}
            productImage={productImage}
            previewScale={tweaks.previewScale}
            showSafeArea={tweaks.showSafeArea}
            onSelectScene={selectScene}
            onTogglePlay={() => setPlaying((value) => !value)}
            onSeek={(time) => setCurrentTime(Math.max(0, Math.min(TOTAL_DURATION - 0.01, time)))}
            onUpdateScene={updateScene}
            onUpload={() => fileRef.current?.click()}
            onRegenerate={() => showToast("单镜重生成将在 Phase B 开放", "Phase A 已完成项目级作业、租约、持久化与恢复骨架")}
            onToast={showToast}
          />
        )}
      </div>
      {accountOpen && <AccountMenu onClose={() => setAccountOpen(false)} onToast={showToast} />}
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
