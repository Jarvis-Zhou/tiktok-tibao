const state = {
  shops: [],
  batches: [],
  tasks: [],
  products: [],
  matches: [],
  nextProductPageToken: null,
  productSource: null,
  selectedProductIds: new Set(),
};

const MAX_PRODUCTS_PER_MATCH = 20;

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body;
}

let toastTimer;
function toast(message, isError = false) {
  const node = $("#toast");
  node.textContent = message;
  node.className = `show${isError ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = ""; }, 4200);
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatPrice(product) {
  if (product.price === null || product.price === undefined) return "—";
  return `${product.currency || ""} ${Number(product.price).toLocaleString()}`.trim();
}

async function loadHealth() {
  const health = await api("/api/health");
  const ready = health.apiConfigured || health.extensionConfigured;
  const labels = [
    health.apiConfigured ? "API 已配置" : "API 待配置",
    health.extensionConfigured ? "插件已配置" : "插件待配置",
  ];
  $("#health").textContent = labels.join(" · ");
  $("#health").className = `health ${ready ? "ok" : "warn"}`;
  const oauthButton = $("#oauth-connect");
  oauthButton.disabled = !health.oauthConfigured;
  const oauthIssues = [
    ...(Array.isArray(health.oauthMissingSettings) ? health.oauthMissingSettings : []),
    ...(health.oauthClientConfigured === false ? ["OAuth 客户端未初始化"] : []),
  ];
  $("#oauth-status").textContent = health.oauthConfigured
    ? "OAuth 已就绪；授权后会添加账号下的店铺，并自动记录各店铺地域。"
    : `OAuth 未就绪：${oauthIssues.length ? `缺少 ${oauthIssues.join("、")}` : "配置未生效"}。请修改仓库根目录 .env 后重启服务。`;
  $("#oauth-callback-url").textContent = new URL(
    health.oauthCallbackPath || "/api/oauth/tiktok/callback",
    window.location.origin,
  ).toString();
}

function showOAuthResult() {
  const search = new URLSearchParams(window.location.search);
  const result = search.get("oauth");
  if (!result) return;
  if (result === "success") {
    const regions = (search.get("regions") || "").split(",").filter(Boolean);
    const regionLabel = regions.length ? `（地域：${regions.join("、")}）` : "";
    toast(`OAuth 授权成功，已连接 ${search.get("shops") || "1"} 个店铺${regionLabel}`);
  } else {
    toast(search.get("message") || "OAuth 授权失败，请重试", true);
  }
  window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
}

function shopOptions(selectedValue) {
  const options = state.shops
    .map((shop) => `<option value="${escapeHtml(shop.id)}">${escapeHtml(shop.name)}${shop.region ? ` · ${escapeHtml(shop.region)}` : ""}</option>`)
    .join("");
  return {
    html: `<option value="">选择店铺</option>${options}`,
    value: state.shops.some((shop) => shop.id === selectedValue) ? selectedValue : (state.shops[0]?.id || ""),
  };
}

async function loadShops() {
  state.shops = (await api("/api/shops")).shops;
  $("#shops").innerHTML = state.shops.length
    ? state.shops
      .map((shop) => `<div class="shop"><div><strong>${escapeHtml(shop.name)}</strong><code>${escapeHtml(shop.id)}</code></div><div class="actions">${shop.region ? `<span class="badge">${escapeHtml(shop.region)}</span>` : '<span class="badge">地域待识别</span>'}${shop.apiConfigured ? `<button class="ghost small" data-shop-test="${escapeHtml(shop.id)}">测试 API</button>` : '<span class="badge">插件店铺</span>'}</div></div>`)
      .join("")
    : '<p class="hint">尚未保存店铺。</p>';

  for (const selector of ["#shop-select", "#match-shop-select"]) {
    const select = $(selector);
    const options = shopOptions(select.value);
    select.innerHTML = options.html;
    select.value = options.value;
  }
}

function countLabel(counts) {
  const entries = Object.entries(counts || {});
  return entries.length ? entries.map(([key, value]) => `${key}: ${value}`).join(" · ") : "—";
}

async function loadBatches() {
  state.batches = (await api("/api/batches")).batches;
  $("#batch-rows").innerHTML = state.batches.length
    ? state.batches
      .map((batch) => `<tr><td><strong>${escapeHtml(batch.filename)}</strong><code>${formatTime(batch.createdAt)}</code></td><td>${batch.validRows}</td><td>${batch.invalidRows}${batch.duplicateRows ? `（历史重复 ${batch.duplicateRows}）` : ""}</td><td>${escapeHtml(countLabel(batch.counts))}</td><td><div class="actions"><button class="primary small" data-run-batch="${batch.id}">运行 API</button><button class="ghost small" data-view-batch="${batch.id}">查看任务</button></div></td></tr>`)
      .join("")
    : '<tr><td colspan="5" class="empty">暂无批次</td></tr>';
  const selected = $("#batch-filter").value;
  $("#batch-filter").innerHTML = '<option value="">全部批次</option>' + state.batches
    .map((batch) => `<option value="${batch.id}">${escapeHtml(batch.filename)} · ${formatTime(batch.createdAt)}</option>`)
    .join("");
  $("#batch-filter").value = state.batches.some((batch) => batch.id === selected) ? selected : "";
}

function taskActions(task) {
  const actions = [];
  if (["failed", "paused"].includes(task.status)) {
    actions.push(`<button class="ghost small" data-retry="${task.id}">重试</button>`);
  }
  if (["ready", "failed", "paused"].includes(task.status)) {
    const target = task.channel === "api" ? "extension" : "api";
    actions.push(`<button class="ghost small" data-channel="${task.id}" data-target="${target}">切到 ${target}</button>`);
  }
  if (["submitted", "pending_review"].includes(task.status) && task.channel === "api") {
    actions.push(`<button class="ghost small" data-sync="${task.id}">同步审核</button>`);
  }
  return actions.join("") || "—";
}

async function loadTasks() {
  const params = new URLSearchParams();
  if ($("#batch-filter").value) params.set("batchId", $("#batch-filter").value);
  if ($("#status-filter").value) params.set("status", $("#status-filter").value);
  state.tasks = (await api(`/api/tasks?${params}`)).tasks;
  $("#task-rows").innerHTML = state.tasks.length
    ? state.tasks
      .map((task) => `<tr><td><strong>${escapeHtml(task.productId)}</strong><code>机会 ${escapeHtml(task.opportunityId)}</code></td><td>${task.channel}</td><td><span class="status ${task.status}">${task.status}</span></td><td>${task.attempts}</td><td>${task.submissionId ? `submission: ${escapeHtml(task.submissionId)}` : task.errorMessage ? `<div class="error-text">${escapeHtml(task.errorMessage)}</div>` : "—"}<code>${task.requestId ? `request: ${escapeHtml(task.requestId)}` : ""}</code></td><td><div class="actions">${taskActions(task)}</div></td></tr>`)
      .join("")
    : '<tr><td colspan="6" class="empty">暂无任务</td></tr>';
  const batch = $("#batch-filter").value;
  $("#export-link").href = `/api/tasks/export.csv${batch ? `?batchId=${encodeURIComponent(batch)}` : ""}`;
}

function manualProductIds() {
  return $("#manual-product-ids").value
    .split(/[\s,;，；]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function allSelectedProductIds() {
  return [...new Set([...state.selectedProductIds, ...manualProductIds()])];
}

function renderProductSelectionSummary() {
  const ids = allSelectedProductIds();
  const node = $("#product-selection-summary");
  node.textContent = ids.length
    ? `已选择 ${ids.length} 个商品${ids.length > MAX_PRODUCTS_PER_MATCH ? `，超过单次上限 ${MAX_PRODUCTS_PER_MATCH}` : ""}。`
    : "尚未选择商品。";
  node.className = `hint${ids.length > MAX_PRODUCTS_PER_MATCH ? " error-text" : ""}`;
  const videoButton = $("#create-video-from-product");
  videoButton.disabled = ids.length !== 1;
  videoButton.title = ids.length === 1 ? "把该商品带入 AI 视频工作台" : "请只选择 1 个商品";
}

function openVideoStudioForSelectedProduct() {
  const ids = allSelectedProductIds();
  if (ids.length !== 1) throw new Error("进入 AI 视频工作台前请只选择 1 个商品");
  const product = state.products.find((item) => item.id === ids[0]);
  const handoff = {
    id: ids[0],
    title: product?.title || ids[0],
    category: product?.categoryNames?.at(-1) || product?.categoryIds?.at(-1) || "",
    brandName: product?.brandName || "",
    shopId: $("#match-shop-select").value,
  };
  sessionStorage.setItem("tibao:video-product", JSON.stringify(handoff));
  const params = new URLSearchParams({ source: "tibao", productId: handoff.id });
  window.location.assign(`/video-studio/?${params}`);
}

function productProgressState(product) {
  const state = product.submissionProgress?.state;
  return ["matched", "no_match", "in_submission"].includes(state) ? state : "pending";
}

function productProgressMeta(product) {
  const state = productProgressState(product);
  return {
    pending: { label: "待匹配提报", className: "pending" },
    matched: { label: "已匹配待提报", className: "matched" },
    no_match: { label: "已匹配无结果", className: "no-match" },
    in_submission: { label: "已进入提报", className: "in-submission" },
  }[state];
}

function visibleProducts() {
  const keyword = $("#product-filter").value.trim().toLowerCase();
  const progress = $("#product-progress-filter").value;
  return state.products.filter((product) => {
    const matchesKeyword = !keyword || `${product.id} ${product.title}`.toLowerCase().includes(keyword);
    const matchesProgress = progress === "all" || productProgressState(product) === progress;
    return matchesKeyword && matchesProgress;
  });
}

function renderProductProgressSummary() {
  const counts = { pending: 0, matched: 0, no_match: 0, in_submission: 0 };
  for (const product of state.products) counts[productProgressState(product)] += 1;
  $("#product-progress-summary").textContent = state.products.length
    ? `已加载 ${state.products.length} 个：待匹配 ${counts.pending} · 待提报 ${counts.matched} · 无结果 ${counts.no_match} · 已进入提报 ${counts.in_submission}${state.nextProductPageToken ? " · 还有下一页" : ""}`
    : "读取商品后会根据本地提报台账显示进度。";
}

function renderProducts() {
  const products = visibleProducts();
  $("#product-rows").innerHTML = products.length
    ? products.map((product) => {
      const category = product.categoryNames.at(-1) || product.categoryIds.at(-1) || "—";
      const progress = product.submissionProgress;
      const progressState = productProgressState(product);
      const progressMeta = productProgressMeta(product);
      let progressDetail = "尚未执行机会匹配";
      if (progressState === "matched") {
        progressDetail = `${progress?.matchCount || 0} 个可提报结果${progress?.lastMatchedAt ? ` · ${formatTime(progress.lastMatchedAt)}` : ""}`;
      } else if (progressState === "no_match") {
        progressDetail = `本次没有可提报结果${progress?.lastMatchedAt ? ` · ${formatTime(progress.lastMatchedAt)}` : ""}`;
      } else if (progressState === "in_submission") {
        progressDetail = `${progress?.taskCount || 0} 条任务 · ${countLabel(progress?.statusCounts)}`;
      }
      return `<tr><td><input type="checkbox" data-product-id="${escapeHtml(product.id)}" ${state.selectedProductIds.has(product.id) ? "checked" : ""} aria-label="选择 ${escapeHtml(product.title)}" /></td><td><strong>${escapeHtml(product.title || product.id)}</strong><code>${escapeHtml(product.id)}</code></td><td>${escapeHtml(category)}<code>${escapeHtml(product.brandName || "无品牌信息")}</code></td><td>${escapeHtml(product.status || "未知")}</td><td>${escapeHtml(formatPrice(product))}</td><td><span class="submission-progress ${progressMeta.className}">${progressMeta.label}</span><code>${escapeHtml(progressDetail)}</code></td></tr>`;
    }).join("")
    : '<tr><td colspan="6" class="empty">当前筛选下没有商品；可调整筛选或直接填写 Product ID</td></tr>';
  const selectedVisibleCount = products.filter((product) => state.selectedProductIds.has(product.id)).length;
  const selectAll = $("#product-select-all");
  selectAll.checked = products.length > 0 && selectedVisibleCount === products.length;
  selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < products.length;
  $("#load-more-products").hidden = !state.nextProductPageToken;
  renderProductProgressSummary();
  renderProductSelectionSummary();
}

async function loadProducts(append = false, { quiet = false } = {}) {
  const shopId = $("#match-shop-select").value;
  if (!shopId) throw new Error("请先选择店铺");
  const params = new URLSearchParams({
    pageSize: "100",
    source: append && state.productSource ? state.productSource : "auto",
  });
  if (append && state.nextProductPageToken) params.set("pageToken", state.nextProductPageToken);
  const result = await api(`/api/shops/${encodeURIComponent(shopId)}/products?${params}`);
  const merged = append ? [...state.products, ...result.products] : result.products;
  state.products = [...new Map(merged.map((product) => [product.id, product])).values()];
  state.nextProductPageToken = result.nextPageToken;
  state.productSource = result.source;
  renderProducts();
  if (!quiet) {
    const sourceLabel = result.source === "extension" ? "插件快照" : "官方 API";
    toast(`已从${sourceLabel}读取 ${state.products.length} 个商品${state.nextProductPageToken ? "，还有下一页" : ""}`);
  }
}

async function selectNextPendingProducts() {
  if (!$("#match-shop-select").value) throw new Error("请先选择店铺");
  if (state.products.length === 0) await loadProducts(false, { quiet: true });

  const seenPageTokens = new Set();
  let pending = state.products.filter((product) => productProgressState(product) === "pending");
  while (pending.length < MAX_PRODUCTS_PER_MATCH && state.nextProductPageToken) {
    if (seenPageTokens.has(state.nextProductPageToken)) break;
    seenPageTokens.add(state.nextProductPageToken);
    await loadProducts(true, { quiet: true });
    pending = state.products.filter((product) => productProgressState(product) === "pending");
  }

  state.selectedProductIds.clear();
  $("#manual-product-ids").value = "";
  $("#product-filter").value = "";
  $("#product-progress-filter").value = "pending";
  for (const product of pending.slice(0, MAX_PRODUCTS_PER_MATCH)) {
    state.selectedProductIds.add(product.id);
  }
  renderProducts();
  toast(
    pending.length > 0
      ? `已筛选并选择 ${Math.min(pending.length, MAX_PRODUCTS_PER_MATCH)} 个待匹配提报商品`
      : "当前已加载全部商品，没有待匹配提报商品",
  );
}

function confidenceLabel(confidence) {
  return confidence === "high" ? "高" : confidence === "medium" ? "中" : "低";
}

function opportunityActiveLabel(active) {
  return active === true ? "true" : active === false ? "false" : "unknown";
}

function isSelectableMatch(match) {
  return match?.eligible === true && match.recommended === true && match.confidence === "high";
}

function selectedMatchStrategy() {
  const mode = $("#match-strategy").value;
  if (mode === "strict") return { mode, diagnosticMinimumScore: 40 };
  const diagnosticMinimumScore = Number($("#diagnostic-min-score").value);
  if (!Number.isSafeInteger(diagnosticMinimumScore) || diagnosticMinimumScore < 0 || diagnosticMinimumScore > 100) {
    throw new Error("诊断候选最低得分必须是 0 到 100 的整数");
  }
  return { mode: "diagnostic", diagnosticMinimumScore };
}

function updateMatchStrategyControls() {
  const diagnostic = $("#match-strategy").value === "diagnostic";
  $("#diagnostic-score-field").hidden = !diagnostic;
  $("#match-strategy-hint").textContent = diagnostic
    ? "诊断模式会额外展示达到最低得分的被拦截候选及原因；风险候选不能勾选或提报。"
    : "严格模式只返回完整规则复核通过且得分不低于 75 的结果。";
}

function syncMatchSelectionState() {
  const checkboxes = [...document.querySelectorAll("[data-match-index]:not(:disabled)")];
  const selectedCount = checkboxes.filter((input) => input.checked).length;
  const selectAll = $("#match-select-all");
  selectAll.disabled = checkboxes.length === 0;
  selectAll.checked = checkboxes.length > 0 && selectedCount === checkboxes.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
  $("#match-selection-summary").textContent = `已选 ${selectedCount} / ${checkboxes.length} 个可提报结果`;
  $("#create-match-batch").disabled = selectedCount === 0;
}

function renderMatchResults(result) {
  state.matches = result.matches || [];
  state.products = state.products.map((product) => {
    const submissionProgress = result.productProgress?.[product.id];
    return submissionProgress ? { ...product, submissionProgress } : product;
  });
  renderProducts();
  if (result.source === "extension") {
    $("#match-channel").value = "extension";
    $("#run-matched-api").checked = false;
    $("#run-matched-api").disabled = true;
  } else {
    $("#match-channel").value = "api";
    $("#run-matched-api").disabled = false;
  }
  $("#match-results").hidden = false;
  const sourceLabel = result.source === "extension" ? "插件快照" : "官方 API";
  const selectableCount = state.matches.filter(isSelectableMatch).length;
  const diagnosticCount = state.matches.length - selectableCount;
  const diagnosticMode = result.strategy?.mode === "diagnostic";
  $("#match-summary").textContent = `${sourceLabel} · ${diagnosticMode ? "诊断模式" : "严格模式"}：已读取 ${result.products.length} 个商品、${result.opportunityCount} 个机会；评估 ${result.candidatePairCount} 个组合，安全拦截 ${result.blockedPairCount} 个，剩余 ${selectableCount} 个高置信度可提报结果${diagnosticMode ? `，另展示 ${diagnosticCount} 个风险候选` : ""}。`;
  $("#match-rows").innerHTML = state.matches.length
    ? state.matches.map((match, index) => {
      const selectable = isSelectableMatch(match);
      const blockers = Array.isArray(match.blockers) ? match.blockers : [];
      const blockerDetail = blockers.length > 0
        ? `<div class="match-blockers">拦截：${blockers.map(escapeHtml).join("；")}</div>`
        : "";
      const opportunityDiagnostics = diagnosticMode
        ? `<div class="match-diagnostics"><code>原始机会状态：${escapeHtml(match.opportunity.status || "未获取")} · active=${opportunityActiveLabel(match.opportunity.active)}</code><code>允许商品状态：${escapeHtml(match.opportunity.allowedProductStatuses?.join("、") || "未声明")}</code></div>`
        : "";
      return `<tr><td><input type="checkbox" data-match-index="${index}" ${selectable ? "" : "disabled"} aria-label="选择商品 ${escapeHtml(match.product.id)} 与机会 ${escapeHtml(match.opportunity.id)}" /></td><td><strong>${escapeHtml(match.product.title || match.product.id)}</strong><code>${escapeHtml(match.product.id)}</code><code>商品状态：${escapeHtml(match.product.status || "未获取")}</code></td><td><strong>${escapeHtml(match.opportunity.title || match.opportunity.id)}</strong><code>${escapeHtml(match.opportunity.type)} · ${escapeHtml(match.opportunity.id)}</code>${opportunityDiagnostics}${selectable ? '<span class="recommendation">可提报</span>' : '<span class="reference-only">风险候选</span>'}</td><td><span class="score ${match.confidence}">${match.score}</span><code>${confidenceLabel(match.confidence)}置信度</code></td><td>${blockerDetail}<div class="match-reason">${match.reasons.map(escapeHtml).join(" · ")}</div></td></tr>`;
    }).join("")
    : `<tr><td colspan="5" class="empty">${diagnosticMode ? "没有达到当前诊断最低得分的候选，可适当降低诊断分数继续排查。" : "没有通过安全复核的机会，可切换诊断模式查看被类目、品牌、状态、关键词、价格或规则完整性拦截的候选。"}</td></tr>`;
  const warnings = result.warnings || [];
  $("#match-warnings").hidden = warnings.length === 0;
  $("#match-warnings").innerHTML = warnings.map((warning) => `<div>• ${escapeHtml(warning)}</div>`).join("");
  syncMatchSelectionState();
}

async function matchSelectedProducts() {
  const shopId = $("#match-shop-select").value;
  const productIds = allSelectedProductIds();
  if (!shopId) throw new Error("请先选择店铺");
  if (productIds.length === 0) throw new Error("至少选择或填写一个 Product ID");
  if (productIds.length > MAX_PRODUCTS_PER_MATCH) {
    throw new Error(`MVP 单次最多匹配 ${MAX_PRODUCTS_PER_MATCH} 个商品`);
  }
  $("#match-results").hidden = true;
  $("#match-progress").hidden = false;
  $("#match-progress").textContent = `正在读取 ${productIds.length} 个商品详情、候选机会和历史提报记录，请勿重复点击…`;
  try {
    const strategy = selectedMatchStrategy();
    const result = await api("/api/opportunity-matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shopId, productIds, source: state.productSource || "auto", strategy }),
    });
    renderMatchResults(result);
    const selectableCount = result.matches.filter(isSelectableMatch).length;
    const diagnosticCount = result.matches.length - selectableCount;
    toast(`匹配完成：${selectableCount} 个可提报结果${strategy.mode === "diagnostic" ? `，${diagnosticCount} 个风险候选` : ""}`);
  } finally {
    $("#match-progress").hidden = true;
  }
}

async function createMatchedBatch() {
  const selected = [...document.querySelectorAll("[data-match-index]:checked")]
    .map((input) => state.matches[Number(input.dataset.matchIndex)])
    .filter(Boolean);
  if (selected.length === 0) throw new Error("请先逐条勾选确认要提报的匹配结果");
  const channel = $("#match-channel").value;
  const runApi = channel === "api" && $("#run-matched-api").checked;
  const result = await api("/api/opportunity-matches/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      shopId: $("#match-shop-select").value,
      confirmed: true,
      runApi,
      selections: selected.map((match) => ({
        productId: match.product.id,
        opportunityId: match.opportunity.id,
        channel,
      })),
    }),
  });
  state.products = state.products.map((product) => {
    const submissionProgress = result.productProgress?.[product.id];
    return submissionProgress ? { ...product, submissionProgress } : product;
  });
  state.selectedProductIds.clear();
  state.matches = [];
  $("#manual-product-ids").value = "";
  $("#product-progress-filter").value = "pending";
  $("#match-results").hidden = true;
  await loadBatches();
  $("#batch-filter").value = result.batch.id;
  await loadTasks();
  renderProducts();
  toast(
    result.started
      ? `批次已创建并启动：有效 ${result.batch.validRows}，重复 ${result.batch.duplicateRows}，可继续选择下一组 20 个`
      : `批次已创建：有效 ${result.batch.validRows}，重复 ${result.batch.duplicateRows}，可继续选择下一组 20 个`,
  );
}

async function refresh() {
  await Promise.all([loadHealth(), loadShops(), loadBatches()]);
  await loadTasks();
}

$("#shop-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/shops", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form)),
    });
    event.currentTarget.reset();
    toast("店铺已保存");
    await loadShops();
  } catch (error) { toast(error.message, true); }
});

$("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await api("/api/batches/import", { method: "POST", body: new FormData(event.currentTarget) });
    toast(`导入完成：有效 ${result.batch.validRows}，无效 ${result.batch.invalidRows}`);
    await Promise.all([loadBatches(), loadTasks()]);
  } catch (error) { toast(error.message, true); }
});

$("#product-filter").addEventListener("input", renderProducts);
$("#product-progress-filter").addEventListener("change", renderProducts);
$("#match-strategy").addEventListener("change", updateMatchStrategyControls);
$("#manual-product-ids").addEventListener("input", renderProductSelectionSummary);
$("#product-select-all").addEventListener("change", (event) => {
  const products = visibleProducts();
  if (!event.currentTarget.checked) {
    for (const product of products) state.selectedProductIds.delete(product.id);
    renderProducts();
    return;
  }

  const selected = new Set(allSelectedProductIds());
  let skipped = 0;
  for (const product of products) {
    if (selected.has(product.id)) {
      state.selectedProductIds.add(product.id);
    } else if (selected.size < MAX_PRODUCTS_PER_MATCH) {
      state.selectedProductIds.add(product.id);
      selected.add(product.id);
    } else {
      skipped += 1;
    }
  }
  renderProducts();
  if (skipped > 0) toast(`单次最多选择 ${MAX_PRODUCTS_PER_MATCH} 个，已保留前 ${MAX_PRODUCTS_PER_MATCH} 个`);
});
$("#match-select-all").addEventListener("change", (event) => {
  for (const input of document.querySelectorAll("[data-match-index]:not(:disabled)")) {
    input.checked = event.currentTarget.checked;
  }
  syncMatchSelectionState();
});
$("#match-shop-select").addEventListener("change", () => {
  state.products = [];
  state.matches = [];
  state.nextProductPageToken = null;
  state.productSource = null;
  state.selectedProductIds.clear();
  $("#manual-product-ids").value = "";
  $("#product-filter").value = "";
  $("#product-progress-filter").value = "all";
  $("#match-results").hidden = true;
  renderProducts();
});
$("#match-channel").addEventListener("change", () => {
  const isApi = $("#match-channel").value === "api";
  $("#run-matched-api").disabled = !isApi;
  if (!isApi) $("#run-matched-api").checked = false;
});

document.addEventListener("change", (event) => {
  const matchInput = event.target.closest("[data-match-index]");
  if (matchInput) {
    syncMatchSelectionState();
    return;
  }
  const input = event.target.closest("[data-product-id]");
  if (!input) return;
  if (input.checked) {
    const selected = new Set(allSelectedProductIds());
    if (!selected.has(input.dataset.productId) && selected.size >= MAX_PRODUCTS_PER_MATCH) {
      input.checked = false;
      toast(`单次最多选择 ${MAX_PRODUCTS_PER_MATCH} 个商品`, true);
      return;
    }
    state.selectedProductIds.add(input.dataset.productId);
  } else {
    state.selectedProductIds.delete(input.dataset.productId);
  }
  renderProducts();
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  try {
    button.disabled = true;
    if (button.id === "load-products") {
      await loadProducts(false);
    } else if (button.id === "oauth-connect") {
      window.location.assign("/api/oauth/tiktok/start");
    } else if (button.id === "load-more-products") {
      await loadProducts(true);
    } else if (button.id === "select-next-pending") {
      await selectNextPendingProducts();
    } else if (button.id === "match-products") {
      await matchSelectedProducts();
    } else if (button.id === "create-video-from-product") {
      openVideoStudioForSelectedProduct();
    } else if (button.id === "create-match-batch") {
      await createMatchedBatch();
    } else if (button.dataset.shopTest) {
      await api(`/api/shops/${button.dataset.shopTest}/test`, { method: "POST" });
      toast("API 连通成功，已读到机会接口响应");
    } else if (button.dataset.runBatch) {
      await api(`/api/batches/${button.dataset.runBatch}/run`, { method: "POST" });
      toast("API 队列已启动");
      setTimeout(refresh, 1000);
    } else if (button.dataset.viewBatch) {
      $("#batch-filter").value = button.dataset.viewBatch;
      await loadTasks();
    } else if (button.dataset.retry) {
      await api(`/api/tasks/${button.dataset.retry}/retry`, { method: "POST" });
      await loadTasks();
    } else if (button.dataset.channel) {
      await api(`/api/tasks/${button.dataset.channel}/channel`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channel: button.dataset.target }),
      });
      toast(`已切换到 ${button.dataset.target}，请确认后再执行`);
      await loadTasks();
    } else if (button.dataset.sync) {
      await api(`/api/tasks/${button.dataset.sync}/sync`, { method: "POST" });
      await loadTasks();
    } else if (button.id === "refresh") {
      await refresh();
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), true);
  } finally {
    button.disabled = false;
  }
});

$("#batch-filter").addEventListener("change", loadTasks);
$("#status-filter").innerHTML += [
  "ready",
  "running",
  "submitted",
  "pending_review",
  "approved",
  "rejected",
  "failed",
  "paused",
].map((status) => `<option value="${status}">${status}</option>`).join("");
$("#status-filter").addEventListener("change", loadTasks);

updateMatchStrategyControls();
refresh()
  .then(showOAuthResult)
  .catch((error) => toast(error.message, true));
