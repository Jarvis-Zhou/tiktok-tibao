import type { OpportunitySnapshot, ProductSnapshot } from "@tibao/core";

export interface ExtensionSettings {
  serverUrl: string;
  extensionKey: string;
  shopId: string;
  opportunityUrlTemplate: string;
  productInputSelector: string;
  submitButtonSelector: string;
  successSelector: string;
  productRowSelector: string;
  productIdSelector: string;
  productTitleSelector: string;
  productStatusSelector: string;
  productCategorySelector: string;
  productBrandSelector: string;
  productPriceSelector: string;
  productStockSelector: string;
}

export interface ExtensionTask {
  id: string;
  batchId: string;
  shopId: string;
  opportunityId: string;
  productId: string;
  channel: "extension";
  status: "running";
  attempts: number;
}

export interface FillMessage {
  type: "TIBAO_FILL";
  task: ExtensionTask;
  profile: Pick<
    ExtensionSettings,
    "productInputSelector" | "submitButtonSelector" | "successSelector"
  >;
  autoSubmit: boolean;
}

export interface FillResult {
  ok: boolean;
  stage: "filled" | "submitted" | "error";
  message: string;
}

export interface CollectedProduct extends ProductSnapshot {
  stock: number | null;
}

export interface CollectedOpportunity extends OpportunitySnapshot {}

export interface CollectProductsMessage {
  type: "TIBAO_COLLECT_PRODUCTS";
  profile: Pick<
    ExtensionSettings,
    | "productRowSelector"
    | "productIdSelector"
    | "productTitleSelector"
    | "productStatusSelector"
    | "productCategorySelector"
    | "productBrandSelector"
    | "productPriceSelector"
    | "productStockSelector"
  >;
}

export interface CollectProductsResult {
  ok: boolean;
  message: string;
  products: CollectedProduct[];
  opportunities: CollectedOpportunity[];
  captureSource: "network" | "dom" | "none";
  sourceUrl: string;
  capturedAt: string;
  scannedRows: number;
}

export interface ProductImportResult {
  total: number;
  inserted: number;
  updated: number;
}

export interface SnapshotImportResult {
  products: ProductImportResult;
  opportunities: ProductImportResult;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverUrl: "http://127.0.0.1:3210",
  extensionKey: "",
  shopId: "",
  opportunityUrlTemplate: "",
  productInputSelector: "",
  submitButtonSelector: "",
  successSelector: "",
  productRowSelector: "",
  productIdSelector: "",
  productTitleSelector: "",
  productStatusSelector: "",
  productCategorySelector: "",
  productBrandSelector: "",
  productPriceSelector: "",
  productStockSelector: "",
};

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored } as ExtensionSettings;
}
