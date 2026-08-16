export const TASK_CHANNELS = ["api", "extension"] as const;
export type TaskChannel = (typeof TASK_CHANNELS)[number];

export const TASK_STATUSES = [
  "invalid",
  "ready",
  "running",
  "paused",
  "submitted",
  "pending_review",
  "approved",
  "rejected",
  "failed",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface ImportTaskInput {
  sourceRow: number;
  shopId: string;
  opportunityId: string;
  productId: string;
  channel: TaskChannel;
}

export interface ImportIssue {
  row: number;
  field: "shop_id" | "opportunity_id" | "product_id" | "channel" | "row";
  code: "required" | "invalid" | "duplicate";
  message: string;
}

export interface ValidatedImportRow {
  input: ImportTaskInput;
  key: string;
}

export interface InvalidImportRow {
  sourceRow: number;
  raw: Record<string, unknown>;
  issues: ImportIssue[];
}

export interface ImportValidationResult {
  valid: ValidatedImportRow[];
  invalid: InvalidImportRow[];
}

export interface TaskRecord {
  id: string;
  batchId: string;
  shopId: string;
  opportunityId: string;
  productId: string;
  channel: TaskChannel;
  status: TaskStatus;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  submissionId: string | null;
  requestId: string | null;
  sourceRow: number;
  createdAt: string;
  updatedAt: string;
}
