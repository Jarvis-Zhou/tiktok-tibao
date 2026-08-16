import {
  checkServer,
  claimTask,
  importSnapshots as uploadSnapshots,
  reportTask,
} from "./local-api.js";
import {
  loadSettings,
  type CollectedOpportunity,
  type CollectedProduct,
  type CollectProductsMessage,
  type CollectProductsResult,
  type ExtensionTask,
  type FillMessage,
  type FillResult,
} from "./types.js";

function requiredElement<T extends Element>(selector: string, constructor: { new (): T }): T {
  const element = document.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`缺少页面元素：${selector}`);
  return element;
}

const statusNode = requiredElement("#status", HTMLElement);
const taskNode = requiredElement("#task", HTMLElement);
const captureCountNode = requiredElement("#capture-count", HTMLElement);
const capturePreviewNode = requiredElement("#capture-preview", HTMLElement);
const collectProductsButton = requiredElement("#collect-products", HTMLButtonElement);
const importProductsButton = requiredElement("#import-products", HTMLButtonElement);
const claimButton = requiredElement("#claim", HTMLButtonElement);
const openButton = requiredElement("#open-page", HTMLButtonElement);
const fillButton = requiredElement("#fill", HTMLButtonElement);
const successButton = requiredElement("#success", HTMLButtonElement);
const failButton = requiredElement("#fail", HTMLButtonElement);
const requeueButton = requiredElement("#requeue", HTMLButtonElement);
const autoSubmitNode = requiredElement("#auto-submit", HTMLInputElement);

let currentTask: ExtensionTask | null = null;
let currentCapture: {
  products: CollectedProduct[];
  opportunities: CollectedOpportunity[];
  sourceUrl: string;
  capturedAt: string;
} | null = null;

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function status(message: string, error = false): void {
  statusNode.textContent = message;
  statusNode.className = error ? "message error" : "message";
}

function renderCapture(): void {
  const products = currentCapture?.products ?? [];
  const opportunities = currentCapture?.opportunities ?? [];
  captureCountNode.textContent = `商品 ${products.length} · 机会 ${opportunities.length}`;
  importProductsButton.disabled = products.length === 0 && opportunities.length === 0;
  if (products.length === 0 && opportunities.length === 0) {
    capturePreviewNode.innerHTML = '<p class="empty">请先打开 Seller Center 商品或机会列表页</p>';
    return;
  }
  const productPreview = products
    .slice(0, 5)
    .map(
      (product) =>
        `<div><strong>${escapeHtml(product.title || product.id)}</strong><code>${escapeHtml(product.id)}</code></div>`,
    )
    .join("");
  const opportunityPreview = opportunities
    .slice(0, 3)
    .map(
      (opportunity) =>
        `<div><strong>${escapeHtml(opportunity.title || opportunity.id)}</strong><code>机会 ${escapeHtml(opportunity.id)}</code></div>`,
    )
    .join("");
  capturePreviewNode.innerHTML = `<div class="capture-list">${productPreview}${opportunityPreview}</div>${
    products.length > 5 || opportunities.length > 3
      ? `<p class="more">本次共识别商品 ${products.length} 个、机会 ${opportunities.length} 个</p>`
      : ""
  }`;
}

function renderTask(): void {
  if (!currentTask) {
    taskNode.innerHTML = '<p class="empty">没有正在处理的任务</p>';
  } else {
    taskNode.innerHTML = `<dl><dt>Product ID</dt><dd>${escapeHtml(currentTask.productId)}</dd><dt>Opportunity ID</dt><dd>${escapeHtml(currentTask.opportunityId)}</dd><dt>尝试次数</dt><dd>${escapeHtml(currentTask.attempts)}</dd></dl>`;
  }
  for (const button of [openButton, fillButton, successButton, failButton, requeueButton]) {
    button.disabled = !currentTask;
  }
}

async function saveCurrent(task: ExtensionTask | null): Promise<void> {
  currentTask = task;
  if (task) await chrome.storage.local.set({ currentTask: task });
  else await chrome.storage.local.remove("currentTask");
  renderTask();
}

async function activeTab(): Promise<chrome.tabs.Tab & { id: number }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("无法获取当前标签页");
  return tab as chrome.tabs.Tab & { id: number };
}

function sendTabMessage<T>(tabId: number, message: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        const disconnected = runtimeError.message?.includes("Receiving end does not exist")
          || runtimeError.message?.includes("Could not establish connection");
        reject(new Error(disconnected
          ? "当前页面未加载 Tibao 页面脚本，请确认域名受支持并刷新当前标签页"
          : runtimeError.message));
        return;
      }
      if (!response) {
        reject(new Error("页面脚本没有返回结果"));
        return;
      }
      resolve(response);
    });
  });
}

collectProductsButton.addEventListener("click", () => void (async () => {
  collectProductsButton.disabled = true;
  try {
    const settings = await loadSettings();
    const tab = await activeTab();
    const message: CollectProductsMessage = {
      type: "TIBAO_COLLECT_PRODUCTS",
      profile: settings,
    };
    const result = await sendTabMessage<CollectProductsResult>(tab.id, message);
    currentCapture = result.ok
      ? {
          products: result.products,
          opportunities: result.opportunities,
          sourceUrl: result.sourceUrl,
          capturedAt: result.capturedAt,
        }
      : null;
    renderCapture();
    status(result.message, !result.ok);
  } catch (error) {
    currentCapture = null;
    renderCapture();
    status(error instanceof Error ? error.message : "无法读取当前页面，请刷新后重试", true);
  } finally {
    collectProductsButton.disabled = false;
  }
})());

importProductsButton.addEventListener("click", () => void (async () => {
  if (!currentCapture) return;
  importProductsButton.disabled = true;
  try {
    const settings = await loadSettings();
    if (!settings.extensionKey) throw new Error("请先在设置页填写插件共享密钥");
    const result = await uploadSnapshots(settings, currentCapture);
    status(
      `导入完成：商品新增 ${result.products.inserted}/更新 ${result.products.updated}；机会新增 ${result.opportunities.inserted}/更新 ${result.opportunities.updated}`,
    );
  } catch (error) {
    status(error instanceof Error ? error.message : String(error), true);
  } finally {
    renderCapture();
  }
})());

claimButton.addEventListener("click", () => void (async () => {
  try {
    const settings = await loadSettings();
    if (!settings.extensionKey) throw new Error("请先在设置页填写插件共享密钥");
    const task = await claimTask(settings);
    await saveCurrent(task);
    status(task ? "已领取任务" : "队列中没有插件任务");
  } catch (error) { status(error instanceof Error ? error.message : String(error), true); }
})());

openButton.addEventListener("click", () => void (async () => {
  if (!currentTask) return;
  try {
    const settings = await loadSettings();
    if (!settings.opportunityUrlTemplate) throw new Error("请先设置机会页面 URL 模板");
    const url = settings.opportunityUrlTemplate.replaceAll("{opportunity_id}", encodeURIComponent(currentTask.opportunityId));
    const tab = await activeTab();
    await chrome.tabs.update(tab.id, { url });
    status("机会页面已打开，加载完成后点击填写");
  } catch (error) { status(error instanceof Error ? error.message : String(error), true); }
})());

fillButton.addEventListener("click", () => void (async () => {
  if (!currentTask) return;
  try {
    const settings = await loadSettings();
    const tab = await activeTab();
    const message: FillMessage = {
      type: "TIBAO_FILL",
      task: currentTask,
      profile: settings,
      autoSubmit: autoSubmitNode.checked,
    };
    const result = await sendTabMessage<FillResult>(tab.id, message);
    status(result.message, !result.ok);
    if (result.ok && result.stage === "submitted") {
      await reportTask(settings, currentTask.id, { status: "submitted" });
      await saveCurrent(null);
    }
  } catch (error) { status(error instanceof Error ? error.message : "无法连接页面脚本，请刷新 Seller Center 页面", true); }
})());

successButton.addEventListener("click", () => void (async () => {
  if (!currentTask || !window.confirm("确认 Seller Center 页面已明确显示提交成功？")) return;
  try {
    const settings = await loadSettings();
    await reportTask(settings, currentTask.id, { status: "submitted" });
    await saveCurrent(null);
    status("任务已标记为 submitted");
  } catch (error) { status(error instanceof Error ? error.message : String(error), true); }
})());

failButton.addEventListener("click", () => void (async () => {
  if (!currentTask) return;
  const reason = window.prompt("请输入失败原因（不会自动重试）：", "页面提交失败");
  if (reason === null) return;
  try {
    const settings = await loadSettings();
    await reportTask(settings, currentTask.id, { status: "failed", errorCode: "EXTENSION_FAILED", errorMessage: reason });
    await saveCurrent(null);
    status("失败原因已记录");
  } catch (error) { status(error instanceof Error ? error.message : String(error), true); }
})());

requeueButton.addEventListener("click", () => void (async () => {
  if (!currentTask) return;
  try {
    const settings = await loadSettings();
    await reportTask(settings, currentTask.id, { status: "ready", errorMessage: "操作员放回插件队列" });
    await saveCurrent(null);
    status("任务已放回队列");
  } catch (error) { status(error instanceof Error ? error.message : String(error), true); }
})());

void (async () => {
  renderCapture();
  const stored = await chrome.storage.local.get("currentTask");
  await saveCurrent((stored.currentTask as ExtensionTask | undefined) ?? null);
  try {
    await checkServer(await loadSettings());
    status("本地服务已连接");
  } catch (error) {
    status(error instanceof Error ? error.message : String(error), true);
  }
})();
