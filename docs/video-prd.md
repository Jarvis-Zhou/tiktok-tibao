# ReCut V1 产品需求文档

> 一个参考短视频，生成你的商品版本。

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 产品暂定名 | ReCut |
| 产品定义 | 爆款短视频结构分析与商品创意重构工作台 |
| 文档版本 | V1.0.1 |
| 文档状态 | 待评审 |
| 更新日期 | 2026-08-17 |
| V1 形态 | Web 应用 |
| 首发内容平台 | TikTok 公开短视频；其他来源通过文件上传 |
| 首发市场 | 跨境电商创作者，优先验证马来西亚市场 |

## 2. 一页结论

ReCut 不是一个“输入一句话直接生成视频”的通用生成器，也不做逐帧复制。它将参考短视频拆成可解释、可编辑的 Video Blueprint，再结合用户商品图片生成新的商品版分镜和视频生成 Prompt。

V1 只跑通最核心链路：

参考视频链接或文件\
→ 爆款结构拆解\
→ 商品图片理解\
→ 商品版 Blueprint\
→ 3–6 镜 Storyboard\
→ 逐镜 Prompt 包导出

V1 不直接生成视频。逐镜视频生成、配音、字幕、成片合成和发布属于后续版本。

## 3. 背景与机会

### 3.1 用户现状

跨境电商卖家和短视频创作者已经能找到大量参考视频，但把一条参考视频改造成自己的商品版本，仍需反复完成以下工作：

- 手工判断开头 Hook、卖点顺序和转化逻辑。
- 逐镜记录时长、机位、动作、字幕和剪辑节奏。
- 思考原视频结构如何适配自己的商品。
- 为图片或视频模型逐镜编写 Prompt。
- 某一镜效果不佳时，重新调整整套方案。
- 将中文卖点改写成目标市场更自然的表达。

现有 AI 视频工具通常从 Prompt 直接生成成片，缺少中间可检查、可修改的蓝图层，导致结果不可控、失败成本高，也难以解释为什么要这样拍。

### 3.2 产品机会

ReCut 把最耗时、最需要经验的“分析与重构”产品化：

- 从“描述视频内容”升级为“解释每个镜头承担的转化作用”。
- 从“一次性生成”升级为“逐镜确认、逐镜修改、逐镜锁定”。
- 从“照搬素材”升级为“迁移结构与节奏，重做商品、场景、人物和文案”。
- 从“模型黑盒”升级为“结构化 Blueprint 驱动的可追踪工作流”。

## 4. 产品定位

### 4.1 定位

以 TikTok 电商内容为首发场景，面向跨境电商的短视频创意分析与生产前工作台。

### 4.2 核心价值主张

用户不需要从零拆解和写 Prompt，只需提供一条参考视频和自己的商品图片，即可获得一套可编辑、可执行、可导出的商品视频方案。

### 4.3 首页主文案

中文：

> 一个爆款链接，生成你的商品版本。

英文：

> Turn a viral video into your product story.

页面不得暗示本产品与 TikTok 官方存在合作、授权或隶属关系。

### 4.4 产品原则

1. 先理解，再改编，最后生成。
2. 所有 AI 结果都必须有结构化中间层。
3. 镜头是最小可编辑、可重试、可锁定单元。
4. 保留转化逻辑，不复制可识别表达。
5. 用户可以看到 AI 为什么做出某项判断。
6. 失败时保留已完成结果，不让用户整项目重来。

## 5. 目标与非目标

### 5.1 V1 目标

- 支持通过参考视频链接或上传文件创建项目。
- 将 3–30 秒参考短视频拆成带时间轴的结构化 Blueprint。
- 从 1–6 张商品图片中生成可编辑的 Product Profile。
- 基于结构参考度，将原 Blueprint 改写为商品版 Blueprint。
- 自动生成 3–6 个竖屏 Storyboard 场景图。
- 为每个场景生成可编辑、可复制、可导出的模型中立 Prompt。
- 支持逐镜重新生成、修改与锁定。
- 支持目标市场和语言下的本地化字幕及口播文案草稿。

### 5.2 V1 非目标

- 不提供 TikTok 视频下载器，不绕过平台访问限制。
- 不直接调用视频模型生成视频。
- 不提供 TTS、字幕烧录、成片合成和 MP4 导出。
- 不自动发布到 TikTok 或其他平台。
- 不分析多条竞品视频的共同模式。
- 不预测播放量、GMV 或承诺视频一定成为爆款。
- 不提供多人实时协作、评论或复杂审批流。
- 不建设完整素材库和历史版本系统。

### 5.3 后续版本边界

| 版本 | 计划能力 |
|---|---|
| V1 | 分析、商品改编、Storyboard、Prompt 包 |
| V1.1 | 逐镜视频生成、供应商切换、单镜重试与延长 |
| V1.2 | 本地化口播、TTS、字幕、时间线合成与 MP4 导出 |
| V2 | 多参考视频洞察、批量创意、团队协作、官方渠道发布 |

## 6. 目标用户

### 6.1 核心用户

#### 跨境电商小团队

- 每周需要持续产出商品短视频。
- 有商品图，但缺少稳定的创意策划和拍摄脚本能力。
- 会使用 Kling、Veo、Seedance 等生成工具，但不会系统编写 Prompt。

#### 短视频投手与内容运营

- 经常从竞品或趋势内容中寻找灵感。
- 需要快速产出多套可测试创意。
- 更看重 Hook、卖点顺序、节奏和转化结构，而非电影级画面。

#### 服务商与自由创作者

- 同时服务多个商品或客户。
- 需要将分析过程和创意方案展示给客户确认。
- 希望减少整片返工，按镜头修改。

### 6.2 核心用户任务

> 当我发现一条值得参考的带货短视频时，我希望系统告诉我它的结构为什么有效，并把这套结构改写成适合我商品的分镜和 Prompt，从而让我更快进入实际制作。

## 7. 核心使用场景

### 场景 A：单条参考视频改编

用户粘贴参考链接、上传商品图，完成分析后查看原视频结构与商品版结构的逐镜映射，确认分镜并导出 Prompt。

### 场景 B：链接不可直接解析

系统成功读取链接元信息并展示嵌入预览，但无法合法、稳定地获取视频文件。系统要求用户上传其有权使用的参考文件，保留已填写的商品和市场信息。

### 场景 C：商品理解有误

AI 将商品材质或用途识别错误。用户在 Product Profile 中修改字段并确认，系统只重新生成受影响的商品版 Blueprint 和未锁定分镜。

### 场景 D：单镜效果不佳

用户修改动作或 Prompt 后，只重新生成当前场景。其他已锁定场景不变。

### 场景 E：目标市场本地化

用户选择 Malaysia 和 Bahasa Melayu。系统按照当地短视频口语习惯改写字幕和口播草稿，不做生硬直译。

## 8. 成功指标

### 8.1 北极星指标

每周完成的有效创意包数量。

“有效创意包”定义为：

- 项目成功生成商品版 Blueprint；
- 至少 4 个场景被用户锁定，或全部场景均已锁定；
- 用户完成 Prompt 包导出。

### 8.2 V1 验证指标

| 指标 | 定义 | 首轮验证目标 |
|---|---|---|
| 输入成功率 | 创建项目后成功进入分析的比例 | ≥ 85% |
| 分析成功率 | 已取得视频文件的任务中，生成有效 Blueprint 的比例 | ≥ 90% |
| 首次可用率 | 用户无需重跑整个项目即可进入 Storyboard 的比例 | ≥ 80% |
| 激活率 | 新用户首个会话内完成至少 1 次 Prompt 导出 | ≥ 40% |
| 分镜采纳率 | 生成后被锁定的分镜数 / 总分镜数 | ≥ 60% |
| 单镜返工次数 | 每个最终锁定场景的平均重新生成次数 | ≤ 2 次 |
| 端到端耗时 | 15 秒视频从开始分析到首版 Storyboard 可查看的 P50 | ≤ 5 分钟 |

首轮验证目标用于 Alpha/Beta 判断，不等于正式 SLA。

### 8.3 护栏指标

- 链接解析失败后成功进入上传降级流程的比例。
- AI 输出 JSON 校验失败率。
- 商品事实被用户纠正的比例。
- 生成内容安全拦截率及误拦截反馈。
- 单个有效创意包的平均模型成本。
- 版权或平台规则相关投诉数量。

## 9. V1 用户流程

### 9.1 主流程

1. 用户进入“新建项目”。
2. 粘贴公开参考链接或直接上传参考视频。
3. 上传 1–6 张商品图片。
4. 选择目标市场、语言、目标时长和结构参考度。
5. 勾选素材权利声明，点击“开始分析”。
6. 系统解析视频、抽帧、转录并分析商品。
7. 用户进入“爆款拆解”，查看并修正 Source Blueprint 与 Product Profile。
8. 用户点击“生成商品版结构”。
9. 系统生成 Source → Adapted 的逐镜映射。
10. 用户确认结构后点击“生成分镜”。
11. 系统逐镜生成 Storyboard 图片和 Prompt。
12. 用户修改、重新生成或锁定每个场景。
13. 用户导出 Prompt 包，前往任意视频生成工具继续制作。

### 9.2 链接降级流程

粘贴链接\
→ 解析 URL 和公开元信息\
→ 尝试通过被允许的能力取得可分析媒体\
→ 无法取得视频文件\
→ 展示嵌入预览与原因\
→ 提示上传参考视频\
→ 用户上传后继续原项目

系统不得将第三方非官方下载器作为核心依赖。

### 9.3 失败恢复流程

- 任一分析阶段失败时显示具体阶段、可读原因和“重试当前阶段”。
- 已完成的抽帧、ASR、Product Profile 等中间产物继续保留。
- 单个 Storyboard 生成失败不阻塞其他场景。
- 用户刷新或离开页面后可恢复到最近一次已保存状态。

## 10. 信息架构

### 10.1 页面

| 页面 | 路径示意 | V1 作用 |
|---|---|---|
| 项目列表 | /projects | 查看、继续和删除自己的项目 |
| 新建项目 | /projects/new | 输入参考视频、商品和创意参数 |
| 分析进度 | /projects/:id/analyzing | 展示异步任务阶段和失败恢复 |
| 爆款拆解 | /projects/:id/blueprint | 查看 Source Blueprint 与 Product Profile |
| 商品版结构 | /projects/:id/adaptation | 对照并确认 Adapted Blueprint |
| 分镜工作台 | /projects/:id/storyboard | 逐镜生成、编辑和锁定 |
| 导出弹窗 | 当前页弹窗 | 导出 Prompt 包 |

### 10.2 V1 导航

- 新建项目
- 我的项目
- 账户与用量

“素材库”“历史版本”“团队评论”保留为后续入口，不在 V1 主导航中展示不可用按钮。

## 11. 页面与交互需求

### 11.1 新建项目页

#### 页面目标

用最少输入完成一次可分析项目创建，并提前解释链接可能需要上传文件。

#### 字段

| 字段 | 是否必填 | 规则 |
|---|---|---|
| 项目名称 | 否 | 默认根据商品和日期生成，可编辑 |
| 参考视频链接 | 二选一 | V1 识别 TikTok 公开视频 URL；先做格式校验 |
| 上传参考视频 | 二选一 | MP4、MOV、WebM；3–30 秒；建议不超过 150 MB |
| 商品图片 | 是 | 1–6 张；JPG、PNG、WebP；单张不超过 10 MB |
| 商品名称 | 否 | 用于提高分类与文案准确度 |
| 已确认卖点 | 否 | 用户提供的真实卖点、使用方式和必要免责声明 |
| 禁用表达 | 否 | 不希望 AI 使用的功效、词语或场景 |
| 目标市场 | 是 | V1 默认 Malaysia，结构上可扩展 |
| 输出语言 | 是 | 默认 Bahasa Melayu；支持 English |
| 目标时长 | 是 | 默认跟随原视频；可选 10、15、20、30 秒 |
| 结构参考度 | 是 | 0–100，默认 60 |
| 素材权利声明 | 是 | 用户确认有权上传和改编相关素材 |

#### 商品图片上传体验

- 展示正面、侧面、细节、使用场景的拍摄建议。
- 支持拖拽、点击和粘贴上传。
- 用户可设置一张“主参考图”。
- 上传后展示缩略图、文件名、删除和重新排序。
- 图片不足 3 张时给出质量提示，但不阻止继续。

#### 开始分析按钮

按钮可用条件：

- 已有可访问的视频文件，或已填写待解析的合法 URL；
- 至少上传 1 张商品图；
- 已完成必填项；
- 已勾选素材权利声明。

如果 URL 只能展示而无法取得媒体，点击后进入“需要上传视频”状态，而不是将整个表单判定为失败。

### 11.2 分析进度页

展示以下阶段：

1. 读取视频与媒体信息。
2. 检测镜头与提取关键帧。
3. 提取口播、字幕和音频特征。
4. 分析镜头作用与转化结构。
5. 理解商品外观、属性与使用方式。
6. 生成可编辑 Blueprint。

每个阶段包含：

- 等待、处理中、完成、失败四种状态；
- 已用时间；
- 当前阶段说明；
- 失败后的重试操作；
- “可安全离开，完成后继续”的提示。

进度不得只依赖虚假的线性百分比。后端阶段状态是唯一事实来源。

### 11.3 爆款拆解页

#### 顶部摘要

- 参考视频预览。
- 时长、镜头数、节奏、口播语言、画幅。
- 视频类型，例如 Problem–Solution、Demo、Before–After、Listicle。
- 结构摘要：Hook → Solution → Demo → Proof → CTA。

#### 逐镜拆解表

| 字段 | 说明 |
|---|---|
| 时间 | 镜头开始与结束时间 |
| 原视频画面 | 关键帧或短预览 |
| 画面描述 | 主体、场景和动作 |
| 摄影方式 | 景别、机位、运镜 |
| 镜头作用 | Hook、Pain、Reveal、Demo、Proof、CTA 等 |
| 留存机制 | 该镜头如何制造信息差、变化或满足感 |
| 证据 | 关键帧、字幕或声音中的依据 |
| 置信度 | 高、中、低 |

#### 爆款模式分析

系统输出的是“转化假设”，不得把没有数据支持的内容表述成确定事实。

需回答：

- Hook 通过什么视觉或文案机制吸引注意？
- 解决方案在第几秒出现？
- 产品在何时、以何种方式首次露出？
- 哪些动作承担功能证明？
- 哪个镜头制造 Before/After 或视觉满足感？
- CTA 是显式还是隐式？
- 哪些元素依赖具体商品，哪些结构可以迁移？

如果没有播放、完播或成交数据，页面显示：

> 以下结论基于内容结构推断，不代表真实投放表现。

### 11.4 Product Profile

Product Profile 与 Source Blueprint 同页展示，可编辑后确认。

字段至少包括：

- 商品类别。
- 材质。
- 形状和尺寸特征。
- 颜色和表面特征。
- 开口、按钮、结构件等关键部位。
- 适合展示的使用动作。
- 可能的使用场景。
- 可从图片直接观察到的卖点。
- 推测信息及其置信度。
- 限制和不适合的使用方式。

每项信息必须标记来源：

- Observed：可直接从图片观察。
- User provided：用户填写或确认。
- Inferred：模型推测，需用户确认后才能作为商品事实写入口播或字幕。

用户修改或确认后，系统保存 Product Profile 版本。涉及功效、食品、健康、美妆等敏感声明时，不允许仅凭图片自动生成确定性宣传。

### 11.5 商品版结构页

页面核心是 Source Blueprint 与 Adapted Blueprint 的逐镜映射。

| 时间 | 原镜头作用 | 原表达 | 新商品改编 | 保留项 | 改写原因 |
|---|---|---|---|---|---|
| 0–2s | Pain Hook | 桌面散乱 | 展示目标用户的具体混乱场景 | Hook 时机、俯拍 | 商品能自然解决该痛点 |
| 2–4s | Reveal | 原商品登场 | 用户商品主图式亮相 | 节奏、手部入镜 | 替换产品与环境 |

用户可以：

- 修改场景、动作、卖点和文案。
- 调整单镜时长。
- 拖拽调整顺序。
- 合并或拆分场景，总数限制为 3–6。
- 锁定结构后生成 Storyboard。

系统需提示时间轴冲突，例如场景重叠、总时长超出目标或 CTA 缺失。

### 11.6 分镜工作台

#### 默认布局

- 左侧：3–6 个场景列表与状态。
- 中间：9:16 Storyboard 大图和原视频参考帧。
- 右侧：当前场景属性、文案与 Prompt。
- 底部：总时间线。

#### 场景卡字段

- 场景编号和结构标签。
- 开始、结束和时长。
- 场景目的。
- Storyboard 图片。
- 主体、环境、动作、机位、景别、运镜和光线。
- 屏幕字幕。
- 口播草稿。
- 通用图片 Prompt。
- 通用视频 Prompt。
- Negative Prompt 或避免项。
- 保留自原视频的变量。
- 与原视频不同的变量。
- 生成状态、质量检查结果、是否过期及锁定状态。

#### 单镜操作

- 修改字段。
- 复制 Prompt。
- 重新生成场景图。
- 仅重新生成 Prompt。
- 上传自定义首帧。
- 人工接受“需检查”的 QC 结果，填写理由并留下审计记录。
- 锁定或解锁。
- 删除或复制场景。

重新生成时必须提供可选范围：

- 保持构图，仅改动作。
- 保持商品，仅改场景。
- 保持所有字段，仅换随机种子。
- 按当前字段完全重做。

任何操作不得修改其他已锁定场景。“需检查”场景不能直接锁定；用户必须先明确接受 QC 结果或重新生成至检查通过。

### 11.7 导出

V1 支持导出一个 ZIP 创意包，至少包含：

- project-summary.md
- source-blueprint.json
- product-profile.json
- adapted-blueprint.json
- prompts.md
- storyboards/scene-01.png 等分镜图片

同时支持：

- 一键复制当前场景 Prompt。
- 一键复制全部视频 Prompt。
- 仅导出 Markdown。
- 仅导出 JSON。

V1 的导出按钮文案为“导出 Prompt 包”，不是“导出视频”。

导出分为两级：

- `draft`：至少一个有效 Storyboard 即可主动导出，manifest 逐镜披露未就绪、需检查、过期和未锁定状态。
- `final`：只有全部场景已 ready、无 stale、锁定的就是当前 revision，且 QC 通过或已留下人工接受记录时才可导出。

用户请求 final 但条件不满足时，页面不能静默降级或只把按钮置灰；必须列出阻塞的场景编号、原因和可执行下一步，并保留“导出草稿包”入口。

## 12. 结构参考度

### 12.1 UI 定义

字段名称使用“结构参考度”，不使用“复制程度”。

原创改编 ←────────●────────→ 结构接近

默认值为 60。用户拖动时展示会被保留和重写的变量。

### 12.2 分段规则

| 数值 | 模式 | 默认保留 | 默认重写 |
|---|---|---|---|
| 0–39 | 创意参考 | 视频类型、Hook 逻辑、整体节奏 | 场景、镜头、动作、台词、人物、视觉风格 |
| 40–74 | 结构参考 | Hook、镜头数量、时间比例、摄影方式、卖点顺序 | 商品、环境、人物、具体动作、文案 |
| 75–100 | 高度参考结构 | Shot timing、机位、运镜类别、动作顺序、剪辑节奏 | 商品、品牌、环境、人物、台词、可识别视觉表达 |

### 12.3 永不保留的内容

无论参考度多高，系统均不得默认复制：

- 原视频人物身份、面部或声音。
- 品牌名称、Logo、包装和商品外观。
- 原字幕逐字文案。
- 原创音乐、受保护音频或水印。
- 具有强识别性的布景、美术和角色设定。
- 无法被用户商品真实完成的动作或功效声明。

高参考度仍然是结构迁移，不是逐帧复现。

## 13. 功能需求清单

### FR-01 项目创建

优先级：P0

验收标准：

- 用户可在 URL 和本地视频中至少选择一种输入方式。
- URL 无法取得视频文件时，商品信息和表单配置不会丢失。
- 用户可上传 1–6 张商品图并设置主图。
- 用户可补充商品名称、已确认卖点和禁用表达，后续结果优先采用用户输入。
- 系统在提交前完成格式、时长、大小和必填项校验。
- 未勾选权利声明时不可开始分析。

### FR-02 视频预处理

优先级：P0

验收标准：

- 系统可读取时长、分辨率、帧率、画幅和音轨信息。
- 系统完成镜头切分、关键帧提取、固定间隔抽帧、音频提取和 ASR。
- 15 秒视频默认抽取约 20–40 个分析帧，实际数量可根据镜头变化调整。
- 中间产物可复用，重试结构分析时不重复执行已成功的预处理。
- 原视频无音轨时仍可完成纯视觉分析。

### FR-03 Source Video Blueprint

优先级：P0

验收标准：

- 输出严格符合版本化 JSON Schema。
- 每个镜头必须包含开始时间、结束时间、视觉描述、摄影方式、目的和证据。
- 镜头时间不重叠，覆盖参考视频至少 90% 的有效时长。
- 系统输出视频类型、Hook、节奏、卖点、字幕和 CTA 类型。
- 系统区分客观观察与转化假设，并提供置信度。
- Schema 校验失败时最多自动修复 2 次，仍失败则显示可重试错误。

### FR-04 Product Profile

优先级：P0

验收标准：

- 系统从图片生成结构化商品画像。
- 每个事实带 observed、user_provided 或 inferred 来源。
- 用户可修改、删除或确认任意推测字段。
- 未确认的敏感功效不得进入最终文案。
- 更新 Product Profile 后，仅标记受影响的 Adapted Blueprint 和未锁定分镜为待更新。

### FR-05 Creative Adaptation

优先级：P0

验收标准：

- 系统结合 Source Blueprint、Product Profile、市场、语言和结构参考度生成 Adapted Blueprint。
- 每个新场景均能追溯到原结构作用或标记为新增。
- 每个场景说明保留项、改写项和改写原因。
- 新 Blueprint 包含 3–6 个场景，时间总和与目标时长误差不超过 0.5 秒。
- 不为商品生成与已确认资料冲突的动作或卖点。
- 用户修改后可保存草稿并重新验证时间轴。

### FR-06 Storyboard 生成

优先级：P0

验收标准：

- 系统为每个场景生成 9:16 参考图。
- Storyboard 中商品的核心外观应与主参考图保持可识别一致。
- 系统检查商品是否出现、主要外观是否一致、是否产生多余结构或异常文字；低置信结果标记为“需检查”，不得静默视为成功，也不能直接锁定。
- 用户可在查看检查结果后明确接受“需检查”场景；系统记录场景 revision、理由、用户和时间后才允许锁定。
- 各场景独立排队、独立失败、独立重试。
- 已锁定场景不会因其他场景的生成或修改而变化。
- 页面在首个场景完成后即可渐进展示，无需等待全部完成。

### FR-07 Prompt 生成与编辑

优先级：P0

验收标准：

- 每镜同时生成通用图片 Prompt 和通用视频 Prompt。
- 视频 Prompt 至少包含画幅、时长、主体、动作、场景、机位、景别、运镜、光线、节奏和避免项。
- Prompt 不包含不存在的商品特征或未确认功效。
- 用户可编辑、复制和恢复 AI 建议版本。
- Prompt 采用模型中立表达，不绑定单一供应商语法。

### FR-08 本地化文案

优先级：P0

验收标准：

- 系统基于目标市场重新表达，而非逐字翻译。
- 每镜可输出屏幕字幕和口播草稿。
- 文案长度与镜头时长相匹配。
- 用户可查看原始含义说明并自行编辑。
- 页面明确标注 AI 生成文案需人工确认。

### FR-09 锁定、保存与恢复

优先级：P0

验收标准：

- 用户可锁定已 ready 的单个场景；“需检查”必须先完成人工接受。
- 自动保存用户编辑，正常网络下保存反馈不晚于编辑停止后 2 秒。
- 刷新页面后恢复最近一次已确认状态。
- 并发更新采用版本号或乐观锁，避免旧响应覆盖新编辑。
- 删除项目需要二次确认。

### FR-10 导出

优先级：P0

验收标准：

- 至少存在一个有效 Storyboard 时可导出草稿包。
- 只有全部场景 ready、无 stale、锁定当前 revision，且 QC 通过或已人工接受时，导出包才标记为 final。
- final 条件不满足时，系统返回阻塞场景及其原因，不静默降级为草稿；用户仍可另行选择导出草稿包。
- ZIP 内文件可正常打开，JSON 通过对应 Schema 校验。
- 导出文件不包含原视频文件，除非用户显式选择且拥有相应权利。
- 导出失败可重试，不触发重新分析或重新生成。

### FR-11 项目列表

优先级：P0

验收标准：

- 展示项目名称、商品缩略图、状态、更新时间和场景完成数。
- 支持继续编辑、复制项目和删除项目。
- 复制项目复用 Source Blueprint，但商品和分镜可重新配置。

## 14. AI 输出协议

所有核心结果必须为版本化 JSON，不允许把自然语言长文作为唯一事实来源。

### 14.1 SourceVideoAnalysis

核心字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| schema_version | string | Schema 版本 |
| duration_sec | number | 视频时长 |
| aspect_ratio | string | 原始画幅 |
| video_type | enum | problem_solution、demo、before_after、listicle、testimonial、other |
| hook | object | 时间、类型、描述、证据和置信度 |
| shots | array | 逐镜结构 |
| selling_points | array | 原视频表达的卖点 |
| pace | enum | slow、medium、fast |
| avg_cut_interval_sec | number | 平均切换间隔 |
| audio_style | object | 节奏、情绪、是否口播 |
| subtitle_style | object | 位置、密度、样式描述 |
| cta | object | 类型、时间和表达 |
| viral_hypotheses | array | 转化假设、证据、置信度 |

每个 shot 至少包含：

- shot_id
- start_sec
- end_sec
- camera_angle
- framing
- subject
- action
- camera_motion
- purpose
- on_screen_text
- speech
- visual_evidence
- confidence

### 14.2 ProductProfile

核心字段：

- schema_version
- category
- material
- shape
- colors
- key_parts
- visual_features
- supported_actions
- possible_use_cases
- limitations
- claims
- source_images

每个属性采用统一 Fact 结构：

- value
- source：observed、user_provided、inferred
- confidence
- evidence
- confirmed_by_user

### 14.3 AdaptedBlueprint

核心字段：

- schema_version
- target_market
- language
- target_duration_sec
- similarity_score
- creative_strategy
- scenes
- localization_notes
- safety_notes

每个 scene 至少包含：

- scene_id
- source_shot_ids
- start_sec
- end_sec
- purpose
- subject
- environment
- action
- camera
- lighting
- selling_point
- overlay_text
- voiceover
- retained_variables
- rewritten_variables
- adaptation_reason
- image_prompt
- video_prompt
- negative_prompt
- status

### 14.4 数据校验规则

- 所有时间使用秒，保留最多两位小数。
- start_sec 必须小于 end_sec。
- 场景不得重叠。
- 枚举外的值使用 other，并提供原始描述。
- 不确定信息不得伪装成 confirmed。
- 用户编辑始终优先于后续模型推断。
- Schema 升级必须保留向后兼容或提供迁移脚本。

## 15. 系统处理流程

### 15.1 分析链路

参考视频\
→ 媒体探测\
→ 镜头检测\
→ 固定间隔与镜头关键帧抽取\
→ Contact Sheet\
→ 音频提取与 ASR\
→ 视觉分析\
→ 时间轴融合\
→ Source Blueprint

### 15.2 商品改编链路

商品图片\
→ 图片质量检查\
→ 多视角商品理解\
→ Product Profile\
→ 用户确认\
→ Source Blueprint + Product Profile + 参考度\
→ Adaptation\
→ Adapted Blueprint

### 15.3 分镜链路

Adapted Blueprint\
→ 场景 Prompt\
→ Storyboard 图片生成\
→ 逐镜质量检查\
→ 用户编辑与锁定\
→ Prompt 包导出

### 15.4 实现原则

- FFmpeg 等确定性工具负责媒体探测、抽帧、音频和转码。
- ASR 负责口播时间轴，不由视觉模型猜测。
- 视觉模型基于关键帧、Contact Sheet 和时间信息完成语义分析。
- LLM 负责结构归纳与创意改编，但输出必须经过 Schema 校验。
- 图片与未来视频模型均通过 Provider Adapter 接入。
- 所有长任务进入队列并具备幂等键。

## 16. 核心数据模型

### Project

- id
- owner_id
- name
- status
- target_market
- language
- target_duration_sec
- similarity_score
- current_step
- created_at
- updated_at

### SourceVideo

- id
- project_id
- source_type：url、upload
- original_url
- embed_metadata
- storage_key
- duration_sec
- width
- height
- fps
- media_status

### Product

- id
- project_id
- name
- image_assets
- primary_image_id

### VideoAnalysis

- id
- project_id
- schema_version
- source_blueprint_json
- transcript
- analysis_status
- model_metadata
- created_at

### ProductAnalysis

- id
- product_id
- schema_version
- product_profile_json
- user_confirmed_at
- model_metadata

### Blueprint

- id
- project_id
- version
- blueprint_type：source、adapted
- data_json
- status：draft、confirmed、superseded

### StoryboardScene

- id
- blueprint_id
- scene_index
- data_json
- image_asset_id
- image_prompt
- video_prompt
- status：pending、generating、ready、failed、locked
- revision

### ExportPackage

- id
- project_id
- blueprint_version
- status
- storage_key
- created_at

### Job

- id
- project_id
- type
- status：queued、running、succeeded、failed、cancelled
- progress_stage
- attempt
- idempotency_key
- error_code
- error_message
- started_at
- finished_at

## 17. 状态机

项目主状态：

draft\
→ ingesting\
→ analyzing\
→ analysis_ready\
→ adapting\
→ adaptation_ready\
→ generating_storyboard\
→ storyboard_ready\
→ exported

异常状态：

- needs_video_upload
- analysis_failed
- adaptation_failed
- partially_generated

状态切换要求：

- 后端负责状态切换，前端只发起动作并展示结果。
- 所有生成类动作必须支持幂等重试。
- 旧任务晚到的结果不得覆盖新版本。
- 部分失败时保留 succeeded 的场景。

## 18. 非功能需求

### 18.1 性能

- 项目列表首屏 P75 小于 2 秒。
- 普通编辑操作反馈小于 200 毫秒。
- 15 秒视频预处理与分析 P50 小于 3 分钟。
- 首张 Storyboard 在结构确认后 P50 小于 90 秒。
- Storyboard 采用渐进加载。

### 18.2 可用性

- 核心异步任务目标成功率不低于 95%，不含内容安全拒绝和无效输入。
- 页面刷新不丢失已保存数据。
- Provider 暂时不可用时支持有限重试和明确错误提示。

### 18.3 安全与隐私

- 所有用户素材默认私有，通过短期签名 URL 访问。
- 存储和传输过程加密。
- 日志不得记录完整媒体 URL、个人信息或用户 Prompt 原文。
- 用户可删除项目及其生成资产。
- 删除请求后的实际清理时限需在上线前写入隐私政策。
- 明确告知第三方模型供应商可能处理哪些素材。

### 18.4 内容与版权

- 上传前要求用户确认拥有使用或改编权利。
- 不提供水印去除和平台限制绕过功能。
- 默认不在导出包中携带参考视频、原音频和原字幕全文。
- 检测到 Logo、公众人物、未成年人或敏感内容时触发提示或限制。
- 分析音乐时仅提取 BPM、情绪和节奏类别，不复制音轨。
- 生成结果需经过供应商安全审核和产品侧规则校验。

### 18.5 可访问性与适配

- 桌面端为 V1 主体验，最低宽度 1280 px。
- 移动端支持查看进度和审阅，不承诺完整时间线编辑。
- 表单、弹窗和场景操作支持键盘导航。
- 颜色状态同时提供文字或图标，不以颜色作为唯一提示。

## 19. 埋点需求

### 19.1 漏斗事件

- project_create_viewed
- source_url_submitted
- source_upload_started
- source_upload_completed
- source_fallback_required
- product_images_uploaded
- analysis_started
- analysis_stage_failed
- analysis_completed
- product_profile_edited
- product_profile_confirmed
- adaptation_started
- adaptation_completed
- similarity_changed
- storyboard_started
- storyboard_scene_ready
- storyboard_scene_regenerated
- storyboard_scene_qc_accepted
- storyboard_scene_locked
- prompt_copied
- export_started
- export_final_blocked
- export_completed

### 19.2 事件公共属性

- project_id
- user_id 的匿名标识
- source_type
- video_duration_bucket
- product_image_count
- target_market
- language
- similarity_bucket
- scene_count
- project_status
- model_provider
- model_version
- latency_ms
- estimated_cost
- error_code

不得把完整视频内容、图片、字幕或 Prompt 写入分析埋点。

## 20. 错误码与用户提示

| 错误码 | 场景 | 用户提示 |
|---|---|---|
| SOURCE_URL_UNSUPPORTED | 不支持的 URL | 当前链接暂不支持，请上传参考视频 |
| SOURCE_MEDIA_UNAVAILABLE | 只能展示，无法取得视频 | 已识别链接，请上传你有权使用的视频文件继续 |
| SOURCE_FILE_INVALID | 文件格式或时长无效 | 请上传 3–30 秒的 MP4、MOV 或 WebM |
| PRODUCT_IMAGE_LOW_QUALITY | 商品图模糊或主体过小 | 建议补充清晰正面图以提高商品一致性 |
| ASR_FAILED | 语音识别失败 | 将继续进行视觉分析，也可重试语音提取 |
| BLUEPRINT_SCHEMA_INVALID | 分析结果无法校验 | 本次结构分析未完成，请重试当前阶段 |
| PRODUCT_PROFILE_UNCONFIRMED | 关键商品信息未确认 | 请先确认标记为“推测”的商品信息 |
| STORYBOARD_PARTIAL_FAILED | 部分场景生成失败 | 其他场景已保留，可单独重试失败场景 |
| PROVIDER_RATE_LIMITED | 供应商限流 | 任务已排队，将自动重试 |
| CONTENT_RESTRICTED | 内容安全限制 | 当前素材或请求无法生成，请调整后重试 |
| EXPORT_FINAL_BLOCKED | 有场景未 ready、需检查、过期或未锁定当前版本 | 列出阻塞的场景编号和原因；完成处理后重试 final，或改为导出草稿包 |
| EXPORT_FAILED | 导出失败 | 项目内容已保存，请重新导出 |

错误提示必须说明：发生了什么、已保留什么、用户下一步能做什么。

## 21. UAT 验收场景

### UAT-01 正常上传流程

给定一个 15 秒 MP4 和 3 张商品图，用户能够完成分析、确认商品画像、生成 3–6 镜分镜并下载 Prompt 包。

### UAT-02 URL 降级

给定一个可嵌入但无法获取媒体的链接，系统不报通用错误，而是保留表单并要求上传文件；上传后可继续同一项目。

### UAT-03 无音轨视频

给定一个无音轨视频，系统跳过 ASR，仍能输出视觉 Blueprint，并明确标记“无可用口播”。

### UAT-04 商品画像修正

用户将商品材质从模型推测值改为真实值后，系统保存修改，后续 Prompt 不再出现旧材质。

### UAT-05 参考度变化

同一项目从 30 调整到 90 后，系统展示保留变量变化并生成新 Blueprint 版本，不覆盖此前已确认版本。

### UAT-06 单镜重做

用户锁定 Scene 01–05，只修改 Scene 06 的 CTA 并重新生成；前五镜的图片、Prompt 和版本保持不变。

### UAT-07 局部失败

六个场景中两个图片任务失败，四个成功场景可立即查看和锁定；失败场景可单独重试。

### UAT-08 本地化

选择 Malaysia 和 Bahasa Melayu 后，系统生成符合镜头时长的口语化草稿，并保留用户可理解的中文意图说明。

### UAT-09 导出完整性

当某场景为 needs_review、stale 或未锁定当前 revision 时，请求 final 返回 `EXPORT_FINAL_BLOCKED`，并准确列出该场景与原因，同时仍可导出 draft。处理所有阻塞项后，最终 ZIP 包包含规定文件，所有 JSON 可通过 Schema 校验，图片与场景编号一一对应。

### UAT-10 权利与安全

未勾选素材权利声明时无法开始；请求复制人物身份、Logo 或逐字字幕时，系统拒绝保留该元素并给出改编建议。

## 22. 上线策略

### Alpha：内部可用

- 仅支持上传视频。
- 首发 Malaysia + Bahasa Melayu / English。
- 每项目最多 6 镜。
- 人工抽检 Source Blueprint、Product Profile 和导出包。
- 目标：验证分析准确度和 Storyboard 可用性。

### Closed Beta：小范围用户

- 开放公开链接解析与上传降级。
- 开放项目列表、用量和失败重试。
- 收集单镜采纳率、修正字段和返工原因。
- 建立商品类别白名单，优先低风险实体商品。

### Public Beta

- 扩展市场和语言。
- 根据成本与质量数据增加图片 Provider。
- 完善删除、隐私、内容申诉和计费策略。

## 23. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 链接无法稳定取得媒体 | 核心入口中断 | URL 只做识别与预览，上传文件是稳定主路径 |
| AI 只会描述画面，不会解释作用 | 产品缺少差异化 | 强制输出 purpose、evidence、hypothesis 和 confidence |
| 商品外观在分镜中失真 | 分镜不可执行 | 多图输入、主图、商品特征锁定、逐镜质量检查 |
| 商品用途或功效幻觉 | 合规与信任风险 | 事实来源标记、用户确认、敏感声明限制 |
| 高参考度导致过度相似 | 版权和平台风险 | 永不保留清单、结构迁移规则、权利声明 |
| 图片生成耗时或失败 | 用户流失 | 渐进展示、单镜重试、Provider Adapter |
| Prompt 只能用于单一模型 | 输出价值下降 | V1 先输出模型中立 Prompt，供应商模板后置 |
| 用户期待直接得到 MP4 | 预期不一致 | 首页和付费页清楚说明 V1 产物是分镜与 Prompt |
| “爆款”结论缺少真实数据 | 误导用户 | 使用“结构推断/转化假设”，不承诺表现 |

## 24. 待产品评审问题

以下问题不阻塞 PRD 进入设计，但必须在开发排期前确认：

1. V1 是否只支持 Malaysia，还是同时开放 Indonesia、Thailand 和 Philippines？
2. Alpha 阶段是否完全关闭 URL 媒体获取，仅支持 URL 预览 + 文件上传？
3. 用户素材和生成资产的默认保留时长是多少？
4. 首批允许的商品类别与禁止类别有哪些？
5. V1 是否需要额度与计费，还是只记录内部用量？
6. Storyboard 图片采用哪一个首发 Provider，质量与单图成本上限是多少？
7. Product Profile 中哪些敏感字段必须人工确认？
8. Prompt 包是否需要额外提供 Kling、Veo、Seedance 的格式模板？
9. 是否允许用户在导出包中附带自己上传的参考视频？
10. 产品最终品牌名是否继续使用 ReCut？

## 25. V1 Definition of Done

满足以下条件方可认为 V1 完成：

- 主流程与所有 P0 功能通过 UAT。
- URL 不可用时上传降级流程可用。
- Source Blueprint、Product Profile、Adapted Blueprint 均有稳定 Schema 和校验。
- 用户可以编辑商品事实、修改单镜、人工接受需检查结果、锁定单镜并恢复项目。
- 3–6 个 Storyboard 可独立生成和重试。
- draft/final Prompt 包语义一致，final 阻塞原因可解释；导出包完整、可读、可被外部视频生成工作流直接使用。
- 已接入基础内容安全、权利声明、隐私删除和成本监控。
- 产品页面没有暗示逐帧复制、平台官方合作或“必然爆款”。
- 现有高保真原型中的“生成视频”“导出视频”已按 V1 范围改为“生成分镜”“导出 Prompt 包”。

## 26. 原型对齐说明

当前 viral-video-remix-hifi 原型已经覆盖：

- 新建项目入口。
- 参考链接和商品图片输入。
- 分析进度。
- 六场景时间线。
- 场景属性编辑。
- 单场景重新生成。

进入 V1 开发前需要补齐或调整：

- 在分析进度与编辑器之间增加“爆款拆解”和“商品版结构确认”。
- 商品图片从单图升级为 1–6 图，并加入 Product Profile。
- 增加结构参考度、目标市场和目标语言。
- 将当前写死的演示场景改为后端 Blueprint 数据。
- 增加原镜头与改编镜头的映射和证据。
- 增加逐镜锁定、局部失败、版本与异步任务状态。
- 将“生成视频”调整为“生成分镜”。
- 将“导出视频”调整为“导出 Prompt 包”。
- 暂时隐藏未实现的素材库、历史版本、评论和成片导出入口。
