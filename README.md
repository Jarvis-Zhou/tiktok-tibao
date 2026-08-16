# Tibao

墨西哥 TikTok Shop “Product Opportunities”批量提报 MVP。项目共用一套导入、校验、幂等和结果台账，同时提供两个执行通道：

- **A / API**：服务端逐条调用官方 Product Opportunities API。
- **C / Chrome Extension**：复用运营人员当前 Seller Center 登录态，辅助打开页面和填写商品 ID；默认最终提交需人工确认。

## 当前能力

- Excel / CSV 导入，中英文表头归一化，文件内和历史任务双重去重。
- SQLite 持久化任务队列；支持失败重试、租约超时恢复、显式切换执行通道。
- TikTok Shop Open API HMAC-SHA256 签名、保守串行限流、瞬时错误重试、request ID 记录。
- 店铺 Access Token 使用 AES-256-GCM 加密存储。
- 店铺商品分页读取；支持在管理页勾选商品或直接粘贴 Product ID。
- 同时拉取 PRODUCT / KEYWORD / CATEGORY 机会，读取机会详情并进行本地硬过滤与可解释评分。
- 本地管理页：选品匹配、人工确认、匹配批次创建、API 队列启动、审核状态同步、CSV 导出。
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

建议用 `openssl rand -hex 32` 分别生成两个随机值。不要把真实密钥、Access Token 或 `.env` 发到群里或提交到 Git。

首次验证顺序：

1. 在页面添加真实 MX 店铺的 `shop_cipher` 与 OAuth Access Token。
2. 点击“测试 API”，只调用 `List Opportunity`。
3. 点击“读取店铺商品”，先选择 1 个商品并运行机会匹配。
4. 逐条检查匹配理由，只勾选明确正确的商品—机会组合。
5. 创建批次；首轮不要勾选“立即启动”，在批次台再次核对后运行 A 通道。
6. 确认提交记录正常后再扩大批次。

## 选品与机会匹配

管理页的主流程是：

1. 选择店铺并从商品目录勾选商品；如果目录接口暂时不可用，也可以直接粘贴 Product ID。
2. API 店铺由服务端重新读取商品详情；插件店铺使用 Seller Center 页面响应中采集并保存在本机的商品快照。
3. API 店铺查询 `PRODUCT`、`KEYWORD`、`CATEGORY` 机会；插件店铺对采集到本机的机会快照进行同一套匹配评分。
4. 硬过滤已过期、未激活、已完成、类目/品牌/商品状态不符，以及本地或平台已提报的组合。
5. 按类目 40、品牌 20、关键词/属性 25、价格带 10、有效性 5 进行评分，并返回逐项理由。
6. 高置信度只显示“推荐候选”，不会自动勾选；运营人员明确确认后才创建现有 A/C 任务批次。

单次最多选择 20 个商品，每类机会最多保留 5 个候选，每个商品最多展示 8 个可提报结果。相同类目的机会查询在单次请求中复用，所有读取请求串行执行，并由 `MATCH_READ_INTERVAL_MS` 控制最小间隔。

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
6. 打开 Seller Center 商品机会列表页并刷新，等待机会加载；再次读取并导入机会快照。
7. 回到本地管理页读取商品，可连续点击“加载更多”浏览全部快照；选中商品后即可在不配置官方 API 的情况下自动匹配机会。
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

## 验证命令

```bash
npm run typecheck
npm test
npm run build
```

## 官方接口

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

- 当前通过管理页手动录入 OAuth Access Token，尚未实现 OAuth 回调与 Token 自动刷新。
- 商品目录与商品详情使用 TikTok Shop Product API `202309` 版本；上线前应使用目标 Partner App 在 MX 店铺沙箱/小流量环境核对该版本和授权 scope。
- Chrome 插件只转发归一化后的商品/机会字段，不转发原始响应、Cookie、请求头或 Token。Seller Center 内部响应字段改版后可能需要更新归一化规则。
- 服务默认只监听 `127.0.0.1`，没有公网登录鉴权；不要改为 `0.0.0.0` 暴露到互联网。
- 单批最多 5000 行，API 默认单并发、间隔 750ms、最多尝试 3 次。
- 机会匹配不会自动提交，也不会自动从 API 失败切到插件；低置信度结果必须人工判断。
- 数据库使用 Node 内置 SQLite，启动时可能看到实验性功能提示。
