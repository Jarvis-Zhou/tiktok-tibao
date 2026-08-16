const state = {
  shops: [],
  batches: [],
  tasks: [],
  products: [],
  matches: [],
  nextProductPageToken: null,
  selectedProductIds: new Set(),
};

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
  return `${product.currency || ""} ${Number(product.price).toLocaleString("es-MX")}`.trim();
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
}

function shopOptions(selectedValue) {
  const options = state.shops
    .map((shop) => `<option value="${escapeHtml(shop.id)}">${escapeHtml(shop.name)}</option>`)
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
      .map((shop) => `<div class="shop"><div><strong>${escapeHtml(shop.name)}</strong><code>${escapeHtml(shop.id)}</code></div>${shop.apiConfigured ? `<button class="ghost small" data-shop-test="${escapeHtml(shop.id)}">测试 API</button>` : '<span class="badge">插件店铺</span>'}</div>`)
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
  if (["failed", "rejected", "paused"].includes(task.status)) {
    actions.push(`<button class="ghost small" data-retry="${task.id}">重试</button>`);
  }
  if (["ready", "failed", "rejected", "paused"].includes(task.status)) {
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
    ? `已选择 ${ids.length} 个商品${ids.length > 20 ? "，超过单次上限 20" : ""}。`
    : "尚未选择商品。";
  node.className = `hint${ids.length > 20 ? " error-text" : ""}`;
}

function visibleProducts() {
  const filter = $("#product-filter").value.trim().toLowerCase();
  if (!filter) return state.products;
  return state.products.filter((product) =>
    `${product.id} ${product.title}`.toLowerCase().includes(filter),
  );
}

function renderProducts() {
  const products = visibleProducts();
  $("#product-rows").innerHTML = products.length
    ? products.map((product) => {
      const category = product.categoryNames.at(-1) || product.categoryIds.at(-1) || "—";
      return `<tr><td><input type="checkbox" data-product-id="${escapeHtml(product.id)}" ${state.selectedProductIds.has(product.id) ? "checked" : ""} aria-label="选择 ${escapeHtml(product.title)}" /></td><td><strong>${escapeHtml(product.title || product.id)}</strong><code>${escapeHtml(product.id)}</code></td><td>${escapeHtml(category)}<code>${escapeHtml(product.brandName || "无品牌信息")}</code></td><td>${escapeHtml(product.status || "未知")}</td><td>${escapeHtml(formatPrice(product))}</td></tr>`;
    }).join("")
    : '<tr><td colspan="5" class="empty">当前列表没有商品；可直接填写 Product ID</td></tr>';
  const allVisibleSelected = products.length > 0 && products.every((product) => state.selectedProductIds.has(product.id));
  $("#product-select-all").checked = allVisibleSelected;
  $("#load-more-products").hidden = !state.nextProductPageToken;
  renderProductSelectionSummary();
}

async function loadProducts(append = false) {
  const shopId = $("#match-shop-select").value;
  if (!shopId) throw new Error("请先选择店铺");
  const params = new URLSearchParams({ pageSize: "50" });
  if (append && state.nextProductPageToken) params.set("pageToken", state.nextProductPageToken);
  const result = await api(`/api/shops/${encodeURIComponent(shopId)}/products?${params}`);
  const merged = append ? [...state.products, ...result.products] : result.products;
  state.products = [...new Map(merged.map((product) => [product.id, product])).values()];
  state.nextProductPageToken = result.nextPageToken;
  renderProducts();
  toast(`已读取 ${state.products.length} 个商品${state.nextProductPageToken ? "，还有下一页" : ""}`);
}

function confidenceLabel(confidence) {
  return confidence === "high" ? "高" : confidence === "medium" ? "中" : "低";
}

function renderMatchResults(result) {
  state.matches = result.matches || [];
  $("#match-results").hidden = false;
  $("#match-summary").textContent = `已读取 ${result.products.length} 个商品、${result.opportunityCount} 个机会；评估 ${result.candidatePairCount} 个组合，硬过滤 ${result.blockedPairCount} 个。`;
  $("#match-rows").innerHTML = state.matches.length
    ? state.matches.map((match, index) => `<tr><td><input type="checkbox" data-match-index="${index}" aria-label="选择商品 ${escapeHtml(match.product.id)} 与机会 ${escapeHtml(match.opportunity.id)}" /></td><td><strong>${escapeHtml(match.product.title || match.product.id)}</strong><code>${escapeHtml(match.product.id)}</code></td><td><strong>${escapeHtml(match.opportunity.title || match.opportunity.id)}</strong><code>${escapeHtml(match.opportunity.type)} · ${escapeHtml(match.opportunity.id)}</code>${match.recommended ? '<span class="recommendation">推荐候选</span>' : ""}</td><td><span class="score ${match.confidence}">${match.score}</span><code>${confidenceLabel(match.confidence)}置信度</code></td><td><div class="match-reason">${match.reasons.map(escapeHtml).join(" · ")}</div></td></tr>`).join("")
    : '<tr><td colspan="5" class="empty">没有通过硬条件过滤的机会，请检查商品类目、品牌和状态。</td></tr>';
  const warnings = result.warnings || [];
  $("#match-warnings").hidden = warnings.length === 0;
  $("#match-warnings").innerHTML = warnings.map((warning) => `<div>• ${escapeHtml(warning)}</div>`).join("");
  $("#create-match-batch").disabled = state.matches.length === 0;
}

async function matchSelectedProducts() {
  const shopId = $("#match-shop-select").value;
  const productIds = allSelectedProductIds();
  if (!shopId) throw new Error("请先选择店铺");
  if (productIds.length === 0) throw new Error("至少选择或填写一个 Product ID");
  if (productIds.length > 20) throw new Error("MVP 单次最多匹配 20 个商品");
  $("#match-results").hidden = true;
  $("#match-progress").hidden = false;
  $("#match-progress").textContent = `正在读取 ${productIds.length} 个商品详情、候选机会和历史提报记录，请勿重复点击…`;
  try {
    const result = await api("/api/opportunity-matches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ shopId, productIds }),
    });
    renderMatchResults(result);
    toast(`匹配完成：返回 ${result.matches.length} 个可选组合`);
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
  toast(
    result.started
      ? `批次已创建并启动：有效 ${result.batch.validRows}，重复 ${result.batch.duplicateRows}`
      : `批次已创建：有效 ${result.batch.validRows}，重复 ${result.batch.duplicateRows}`,
  );
  await Promise.all([loadBatches(), loadTasks()]);
  $("#batch-filter").value = result.batch.id;
  await loadTasks();
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
$("#manual-product-ids").addEventListener("input", renderProductSelectionSummary);
$("#product-select-all").addEventListener("change", (event) => {
  for (const product of visibleProducts()) {
    if (event.currentTarget.checked) state.selectedProductIds.add(product.id);
    else state.selectedProductIds.delete(product.id);
  }
  renderProducts();
});
$("#match-shop-select").addEventListener("change", () => {
  state.products = [];
  state.matches = [];
  state.nextProductPageToken = null;
  state.selectedProductIds.clear();
  $("#manual-product-ids").value = "";
  $("#match-results").hidden = true;
  renderProducts();
});
$("#match-channel").addEventListener("change", () => {
  const isApi = $("#match-channel").value === "api";
  $("#run-matched-api").disabled = !isApi;
  if (!isApi) $("#run-matched-api").checked = false;
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-product-id]");
  if (!input) return;
  if (input.checked) state.selectedProductIds.add(input.dataset.productId);
  else state.selectedProductIds.delete(input.dataset.productId);
  renderProductSelectionSummary();
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  try {
    button.disabled = true;
    if (button.id === "load-products") {
      await loadProducts(false);
    } else if (button.id === "load-more-products") {
      await loadProducts(true);
    } else if (button.id === "match-products") {
      await matchSelectedProducts();
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

refresh().catch((error) => toast(error.message, true));
