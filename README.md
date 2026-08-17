# Tibao

TikTok Shop 多地域 “Product Opportunities” 批量提报 MVP。项目共用一套导入、校验、幂等和结果台账，同时提供两个执行通道：

- **A / API**：服务端逐条调用官方 Product Opportunities API。
- **C / Chrome Extension**：复用运营人员当前 Seller Center 登录态，辅助打开页面和填写商品 ID；默认最终提交需人工确认。

## 当前能力

- Excel / CSV 导入，中英文表头归一化，文件内和历史任务双重去重。
- SQLite 持久化任务队列；支持失败重试、租约超时恢复、显式切换执行通道。
- TikTok Shop Open API HMAC-SHA256 签名、保守串行限流、瞬时错误重试、request ID 记录。
- TikTok Shop OAuth 授权入口与回调：一次性 state 校验、授权码换 Token、自动发现并导入全部已授权店铺及其地域。
- 店铺 Access Token 使用 AES-256-GCM 加密存储。
- 店铺商品分页读取；支持在管理页勾选商品或直接粘贴 Product ID。
- 同时拉取 PRODUCT / KEYWORD / CATEGORY 机会，读取机会详情并进行 fail-closed 安全过滤与可解释评分。
- 本地管理页：按持久化台账筛选待匹配、已匹配待提报、已匹配无结果或已进入提报商品，一键选择下一组 20 个；支持严格/诊断匹配策略、诊断最低分、匹配结果安全全选、匹配批次创建、API 队列启动、审核状态同步和 CSV 导出。
- Chrome MV3 插件：从 Seller Center 已加载的 JSON 响应采集商品与机会快照并幂等导入本地 SQLite；插件店铺可离线完成自动匹配；领取任务、打开机会页、填写商品 ID、人工确认结果。

## 本地启动

要求 Node.js `>= 22.5`。

```bash
npm install
cp .env.example .env
npm run dev
```

然后打开 <http://127.0.0.1:3210>。

只使用 Chrome 插件时至少配置：

```dotenv
EXTENSION_SHARED_KEY=另一个随机字符串
```

使用 A / 官方 API 通道时再配置：

```dotenv
TIKTOK_APP_KEY=你的 Partner Center app_key
TIKTOK_APP_SECRET=你的 app_secret
TOKEN_ENCRYPTION_KEY=至少32位随机字符串
```

并在 TikTok Shop Partner Center 的应用配置中登记回调地址：

```text
http://127.0.0.1:3210/api/oauth/tiktok/callback
```

如果不是用默认地址打开管理页，把上面的协议、域名和端口替换成页面实际 Origin；页面会直接显示应登记的完整回调地址。回调地址由 Partner Center 固定配置，授权入口只发送 `app_key` 和一次性 `state`。

建议用 `openssl rand -hex 32` 分别生成两个随机值。不要把真实密钥、Access Token 或 `.env` 发到群里或提交到 Git。

如果页面提示“服务端 OAuth 配置不完整”，请确认 `TIKTOK_APP_KEY`、`TIKTOK_APP_SECRET`、`TOKEN_ENCRYPTION_KEY` 都位于仓库根目录的 `.env`，然后完整停止并重新执行 `npm run dev`。访问 <http://127.0.0.1:3210/api/health> 可查看 `oauthMissingSettings`，只会返回缺失的变量名，不会返回密钥值。

首次验证顺序：

1. 点击“登录 TikTok Shop 并授权”；回调成功后会自动换取 Access Token，并从 `GET /authorization/202309/shops` 导入全部已授权店铺的 `shop_cipher` 与 `region`。也可保留手动录入作为备用。
2. 点击“测试 API”，只调用 `List Opportunity`。
3. 点击“读取店铺商品”，先选择 1 个商品并运行机会匹配。
4. 逐条检查匹配理由，只勾选明确正确的商品—机会组合。
5. 创建批次；首轮不要勾选“立即启动”，在批次台再次核对后运行 A 通道。
6. 确认提交记录正常后再扩大批次。

## 选品与机会匹配

管理页的主流程是：

1. 选择店铺并从商品目录勾选商品；可按“待匹配提报 / 已匹配待提报 / 已匹配无结果 / 已进入提报”筛选，或一键选择下一组 20 个。如果目录接口暂时不可用，也可以直接粘贴 Product ID。
2. API 店铺由服务端重新读取商品详情；插件店铺使用 Seller Center 页面响应中采集并保存在本机的商品快照。
3. API 店铺查询 `PRODUCT`、`KEYWORD`、`CATEGORY` 机会；插件店铺对采集到本机的机会快照进行同一套匹配评分。
4. “严格”策略是默认值，只展示可提报结果；“诊断”策略还会展示达到所设最低分的风险候选，用于排查具体被哪条规则拦截。
5. 硬过滤已过期、未激活、已完成、类目/品牌/商品状态/关键词/价格区间不符，以及本地或平台已提报的组合；机会详情、完整规则、类目或状态缺失时按不可验证直接排除。
6. 按类目 40、品牌 20、关键词/属性 25、价格带 10、有效性 5 进行评分，并返回逐项理由和拦截原因。
7. 只有分数不低于 75 且完整规则全部通过的高置信度结果可以勾选或全选。诊断候选始终禁用选择；服务创建批次时仍会按严格规则重新读取并复核所选组合，通过后才创建 A/C 任务。

API 任务调用提报接口前还会重新读取商品与机会详情。若规则无法读取或最新数据不再匹配，任务会进入 `paused` 并记录 `LOCAL_ELIGIBILITY_CHECK_*`，不会调用 TikTok 提报接口。插件领取任务时也会复核本地快照，快照超过 24 小时、缺少完整规则或不再匹配时会暂停任务。已被平台审核拒绝的任务禁止直接重试或切换通道，必须重新采集并匹配，避免重复拒绝。

单次最多选择 20 个商品，每类机会最多保留 5 个候选，每个商品最多展示 8 个结果。每次成功匹配后，服务只按严格规则通过的安全结果计数，并把商品持久化标记为“已匹配待提报”或“已匹配无结果”；诊断模式展示了风险候选但没有安全结果时，仍属于“已匹配无结果”。商品一旦创建过任意提报任务（包括待执行、成功、失败、暂停或拒绝），状态则以“已进入提报”为准。“下一组 20 个”只选择从未成功完成匹配的商品，因此零结果商品也不会被重复选中；进度保存在 SQLite，刷新页面或重启服务不会丢失。读取商品详情失败的商品仍保留“待匹配提报”，便于修复后重试。相同类目的机会查询在单次请求中复用，所有读取请求串行执行，并由 `MATCH_READ_INTERVAL_MS` 控制最小间隔。

## OAuth 回调流程

1. 管理页请求 `/api/oauth/tiktok/start`，服务生成 10 分钟有效且只能使用一次的随机 `state`。
2. 浏览器跳转到 TikTok Shop 授权页；TikTok 按 Partner Center 中登记的地址回调 `/api/oauth/tiktok/callback`。
3. 服务校验并立即消费 `state`，使用回调中的 `code` / `auth_code` 调用 `GET https://auth.tiktok-shops.com/api/v2/token/get`。
4. 服务使用 Access Token 调用 `GET /authorization/202309/shops`，导入所有带 `shop_cipher` 的店铺，并将每个店铺返回的 `region` 和 AES-256-GCM 加密后的 Token 写入 SQLite；单店未返回地域时使用 OAuth 的 `seller_base_region` 兜底。
5. 浏览器回到管理页，只显示成功数量、地域或错误信息；Access Token、App Secret 与授权码不会返回前端。

手动录入 API 凭证时，服务也会通过授权店铺接口匹配 Shop Cipher 并自动记录地域。Chrome 插件导入 Seller Center 快照时，则从页面 URL 的 `shop_region` / `region` 参数更新店铺地域。无法可靠识别时保持“地域待识别”，不会猜测。

取消授权、state 过期或授权账号中没有带 Shop Cipher 的店铺时不会写入店铺。当前服务只监听本机回环地址；不要为了 OAuth 回调直接把未鉴权的管理页长期暴露到公网。

## 导入格式

模板在 [`examples/import-template.csv`](examples/import-template.csv)。支持以下表头别名：

| 标准字段 | 常用别名 | 说明 |
|---|---|---|
| `shop_id` | `shop`、`店铺`、`店铺ID` | 页面保存店铺后生成的内部 ID；在页面选择默认店铺时可留空 |
| `opportunity_id` | `机会ID`、`商品机会ID` | TikTok Opportunity ID |
| `product_id` | `商品ID` | 已激活的店铺商品 ID，Excel 中应设为文本 |
| `channel` | `通道`、`执行方式` | `api` / `A` 或 `extension` / `C` |

同一 `shop_id + opportunity_id + product_id` 只创建一条任务。API 失败不会自动切到插件；必须在任务台显式切换。

## Chrome 插件

```bash
npm run build:extension
```

1. 打开 Chrome `chrome://extensions`，启用开发者模式。
2. 选择“加载已解压的扩展程序”，目录为 `apps/extension/build`。
3. 只用插件时，在本地管理页仅填写店铺名称即可创建“插件店铺”；复制页面显示的店铺 ID。
4. 打开插件设置页，填写本地服务地址、`EXTENSION_SHARED_KEY`、本地店铺 ID。Seller Center 默认直接读取页面已加载的 JSON，不依赖易变的 DOM 类名。
5. 安装或升级插件后刷新 Seller Center 商品管理页，等待列表加载；点击“读取当前页快照”并导入。多页商品可逐页导入，相同 Product ID 会更新而不重复新增。
6. 打开 Seller Center 商品机会列表页并刷新，等待机会及提报规则加载；再次读取并导入机会快照。升级到本版本后需重新采集，旧版缺少规则完整性标记的机会快照不会参与匹配。
7. 回到本地管理页读取商品，可按提报进度筛选，或点击“筛选并选择下 20 个”（需要时会继续翻页补足）；选中商品后即可在不配置官方 API 的情况下自动匹配机会。
8. 确认组合并创建 `extension` 通道批次，再由插件领取执行。

无需登录 TikTok 的独立采集测试：启动本地服务后打开
<http://127.0.0.1:3210/extension-product-fixture.html>，应能从插件识别 3 个模拟商品。

机会页面模板可包含 `{opportunity_id}`。例如：

```text
https://实际的-seller-center-地址/path/{opportunity_id}
```

插件默认只填写，不点击最终提交。若勾选“本次允许自动点击提交”，还必须配置提交按钮与成功标识选择器；只有检测到成功标识才会自动回写 `submitted`。

生成 Chrome Web Store 可上传的 ZIP 包：

```bash
npm run package:extension
```

产物位于 `apps/extension/dist/tibao-extension-<version>.zip`，压缩包根目录直接包含 `manifest.json`。Chrome 的开发者模式不能直接加载 ZIP；本地测试时先解压，再选择“加载已解压的扩展程序”。

## AI 视频工作台

本地服务同时挂载了 ReCut 高保真视频工作台：

```text
http://127.0.0.1:3210/video-studio/
```

可以从管理页顶部直接进入；也可以在商品列表中只勾选一个商品，然后点击“用所选商品制作 AI 视频”。后者会通过同源 `sessionStorage` 把商品 ID、标题、类目和品牌带入工作台，不会把店铺 Token、Cookie 或其他凭证传给视频页面。

工作台支持粘贴参考视频链接，或选择不超过 200 MB 的本地 MP4，并上传一张 PNG、JPG 或 WebP 商品图片。本地文件只存在当前浏览器会话中，不会上传到 Tibao 服务端。

当前集成的是 `viral-video-remix-hifi` 的高保真交互原型：分析进度、场景重生成、成片生成和导出均为演示，不会调用真实 AI 模型，也不会生成 MP4。接入真实能力时应在服务端增加上传存储、异步任务台账和模型供应商适配层，密钥只保存在服务端。

功能基线见 [`docs/video-prd.md`](docs/video-prd.md)，后端的 V1 范围、API、数据模型、异步作业、资产安全和分阶段实施方案见 [`docs/video-backend-design.md`](docs/video-backend-design.md)。V1 的正式产物是 3–6 镜 Storyboard 与 Prompt 包，不包含视频模型调用或 MP4 导出。

## 验证命令

```bash
npm run typecheck
npm test
npm run build
```

## 官方接口

- `GET https://auth.tiktok-shops.com/oauth/authorize`（OAuth 授权）
- `GET https://auth.tiktok-shops.com/api/v2/token/get`（授权码换 Token）
- `GET /authorization/202309/shops`（读取 Shop Cipher）
- `POST /product/202309/products/search`（版本可用 `TIKTOK_PRODUCT_API_VERSION` 调整）
- `GET /product/202309/products/{product_id}`
- `POST /product/202604/opportunities/query`
- `GET /product/202604/opportunities/{opportunity_id}`
- `POST /product/202604/opportunities/{opportunity_id}/submit`
- `GET /product/202604/opportunities/submissions`

官方文档：

- <https://partner.tiktokshop.com/docv2/page/69dde24cf76068049e2730b8>
- <https://partner.tiktokshop.com/docv2/page/69dde24b4ae06d04a2bc8150>
- <https://partner.tiktokshop.com/docv2/page/69dde24dcb1ea3049af16700>
- <https://partner.tiktokshop.com/docv2/page/69dde24ef76068049e2730c7>

## MVP 边界

- 已实现 OAuth 回调、Access Token 加密保存，以及多地域 Shop Cipher / region 自动发现；Refresh Token 自动续期尚未接入，Token 过期后需重新授权。
- 商品目录与商品详情使用 TikTok Shop Product API `202309` 版本；上线前应使用目标 Partner App 在各目标地域店铺的沙箱/小流量环境核对该版本和授权 scope。
- Chrome 插件只转发归一化后的商品/机会字段，不转发原始响应、Cookie、请求头或 Token。Seller Center 内部响应字段改版后可能需要更新归一化规则。
- 服务默认只监听 `127.0.0.1`，没有公网登录鉴权；不要改为 `0.0.0.0` 暴露到互联网。
- 单批最多 5000 行，API 默认单并发、间隔 750ms、最多尝试 3 次。
- 机会匹配不会自动提交，也不会自动从 API 失败切到插件；低置信度或规则不可验证的结果不能创建匹配批次。
- 数据库使用 Node 内置 SQLite，启动时可能看到实验性功能提示。
