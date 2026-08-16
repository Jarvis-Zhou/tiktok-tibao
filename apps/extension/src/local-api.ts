import type {
  CollectedOpportunity,
  CollectedProduct,
  ExtensionSettings,
  ExtensionTask,
  SnapshotImportResult,
} from "./types.js";

async function request<T>(
  settings: ExtensionSettings,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const response = await fetch(`${settings.serverUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-extension-key": settings.extensionKey,
      ...init.headers,
    },
  });
  if (response.status === 204) return null;
  const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || `本地服务请求失败：${response.status}`);
  return body;
}

export async function checkServer(settings: ExtensionSettings): Promise<void> {
  const response = await fetch(`${settings.serverUrl.replace(/\/$/, "")}/api/health`);
  if (!response.ok) throw new Error("本地 Tibao 服务不可用");
}

export async function claimTask(settings: ExtensionSettings): Promise<ExtensionTask | null> {
  const suffix = settings.shopId ? `?shopId=${encodeURIComponent(settings.shopId)}` : "";
  const result = await request<{ task: ExtensionTask }>(settings, `/api/extension/tasks/next${suffix}`);
  return result?.task ?? null;
}

export async function reportTask(
  settings: ExtensionSettings,
  taskId: string,
  result: {
    status: "submitted" | "failed" | "ready";
    submissionId?: string;
    errorCode?: string;
    errorMessage?: string;
  },
): Promise<void> {
  await request(settings, `/api/extension/tasks/${encodeURIComponent(taskId)}/result`, {
    method: "POST",
    body: JSON.stringify(result),
  });
}

export async function importSnapshots(
  settings: ExtensionSettings,
  capture: {
    products: CollectedProduct[];
    opportunities: CollectedOpportunity[];
    sourceUrl: string;
    capturedAt: string;
  },
): Promise<SnapshotImportResult> {
  if (!settings.shopId) throw new Error("请先在设置页填写本地店铺 ID");
  const response = await request<{ result: SnapshotImportResult }>(
    settings,
    "/api/extension/snapshots/import",
    {
      method: "POST",
      body: JSON.stringify({
        shopId: settings.shopId,
        sourceUrl: capture.sourceUrl,
        capturedAt: capture.capturedAt,
        products: capture.products,
        opportunities: capture.opportunities,
      }),
    },
  );
  if (!response) throw new Error("本地服务没有返回导入结果");
  return response.result;
}
