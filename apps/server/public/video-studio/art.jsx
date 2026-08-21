const ICON_PATHS = {
  home: <><path d="M3.5 10.5 12 3l8.5 7.5"></path><path d="M5.5 9.5V21h13V9.5"></path><path d="M9.5 21v-7h5v7"></path></>,
  spark: <><path d="m12 2 1.25 5.02a5 5 0 0 0 3.65 3.65L22 12l-5.1 1.33a5 5 0 0 0-3.65 3.65L12 22l-1.25-5.02a5 5 0 0 0-3.65-3.65L2 12l5.1-1.33a5 5 0 0 0 3.65-3.65L12 2Z"></path></>,
  folder: <><path d="M3 6.5h7l2 2h9v10.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5Z"></path><path d="M3 10h18"></path></>,
  clock: <><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></>,
  settings: <><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.08A1.7 1.7 0 0 0 9 19.37a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15a1.7 1.7 0 0 0-1.55-1.03H3v-4h.08A1.7 1.7 0 0 0 4.63 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63a1.7 1.7 0 0 0 1.03-1.55V3h4v.08A1.7 1.7 0 0 0 15 4.63a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9a1.7 1.7 0 0 0 1.55 1.03H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"></path></>,
  link: <><path d="M10.5 13.5a4 4 0 0 0 5.66 0l2.34-2.34a4 4 0 0 0-5.66-5.66L11.5 6.84"></path><path d="M13.5 10.5a4 4 0 0 0-5.66 0L5.5 12.84a4 4 0 0 0 5.66 5.66l1.34-1.34"></path></>,
  upload: <><path d="M12 16V4"></path><path d="m7 9 5-5 5 5"></path><path d="M4 15v5h16v-5"></path></>,
  film: <><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 5v14M17 5v14M3 9h4M17 9h4M3 15h4M17 15h4"></path></>,
  play: <><path d="m9 6 9 6-9 6V6Z"></path></>,
  pause: <><path d="M9 6v12M15 6v12"></path></>,
  chevron: <><path d="m9 18 6-6-6-6"></path></>,
  back: <><path d="m15 18-6-6 6-6"></path></>,
  check: <><path d="m5 12 4 4L19 6"></path></>,
  close: <><path d="m6 6 12 12M18 6 6 18"></path></>,
  plus: <><path d="M12 5v14M5 12h14"></path></>,
  wand: <><path d="m15 4 5 5L8 21l-5-5L15 4Z"></path><path d="m12 7 5 5M6 4v3M4.5 5.5h3M19 16v4M17 18h4"></path></>,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1"></rect><rect x="14" y="4" width="6" height="6" rx="1"></rect><rect x="4" y="14" width="6" height="6" rx="1"></rect><rect x="14" y="14" width="6" height="6" rx="1"></rect></>,
  volume: <><path d="M5 10v4h3l4 4V6l-4 4H5Z"></path><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"></path></>,
  subtitles: <><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M7 15h4M14 15h3M7 11h7"></path></>,
  download: <><path d="M12 4v11"></path><path d="m7 11 5 5 5-5"></path><path d="M4 20h16"></path></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m3 12 9 5 9-5M3 16l9 5 9-5"></path></>,
  dots: <><circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle></>,
  redo: <><path d="M19 8v5h-5"></path><path d="M18.2 13A7 7 0 1 1 16 6.6L19 9"></path></>,
  comment: <><path d="M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z"></path></>,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"></path></>
};

function Icon({ name, size = 20, className = "" }) {
  return (
    <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name] || ICON_PATHS.spark}
    </svg>
  );
}

function BrandMark({ compact = false }) {
  return (
    <div className={`brand-mark ${compact ? "compact" : ""}`} aria-label="ReCut">
      <span className="brand-glyph"><i></i><i></i><i></i></span>
      {!compact && <span className="brand-word">RE<span>:</span>CUT</span>}
    </div>
  );
}

function ProductArt({ image, compact = false, variant = "mint" }) {
  if (image) {
    return <img className="product-uploaded-image" src={image} alt="已上传的商品素材" />;
  }
  return (
    <div className={`product-art product-missing ${compact ? "compact" : ""} ${variant}`} aria-label="尚未载入商品图片">
      <Icon name="upload" size={compact ? 12 : 22} />
      {!compact && <span>NO PRODUCT IMAGE</span>}
    </div>
  );
}

function ReferenceFrame({ mini = false, playing = false, source = "" }) {
  if (source) {
    return (
      <div className={`reference-frame real-source ${mini ? "mini" : ""}`}>
        <video src={source} muted playsInline loop autoPlay={playing} controls={!playing} preload="metadata"></video>
        <div className="ref-play"><Icon name={playing ? "pause" : "play"} size={mini ? 12 : 18} /></div>
      </div>
    );
  }
  return (
    <div className={`reference-frame reference-missing ${mini ? "mini" : ""}`}>
      <Icon name="film" size={mini ? 16 : 30} />
      {!mini && <span>等待参考视频</span>}
      <div className="ref-play"><Icon name={playing ? "pause" : "play"} size={mini ? 12 : 18} /></div>
    </div>
  );
}

function MiniSceneArt({ scene, active, index = 0 }) {
  const palette = ["orange", "blue", "mint", "violet", "rose", "amber"];
  return (
    <div className={`mini-scene-art ${palette[index % palette.length]} ${active ? "active" : ""}`}>
      {scene.storyboardUrl ? <img src={scene.storyboardUrl} alt="" /> : <div className="mini-frame-lines"></div>}
      <span>{String(index + 1).padStart(2, "0")}</span>
      {!scene.storyboardUrl && <div className="mini-type">{scene.short}</div>}
    </div>
  );
}

Object.assign(window, { Icon, BrandMark, ProductArt, ReferenceFrame, MiniSceneArt });
