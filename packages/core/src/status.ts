import type { TaskStatus } from "./types.js";

const transitions: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  invalid: new Set(),
  ready: new Set(["running", "paused", "failed"]),
  running: new Set(["ready", "submitted", "pending_review", "failed", "paused"]),
  paused: new Set(["ready", "failed"]),
  submitted: new Set(["pending_review", "approved", "rejected", "failed"]),
  pending_review: new Set(["approved", "rejected", "failed"]),
  approved: new Set(),
  rejected: new Set(["ready"]),
  failed: new Set(["ready", "paused"]),
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || transitions[from].has(to);
}

export function normalizeReviewStatus(value: unknown): TaskStatus | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  switch (normalized) {
    case "PENDING":
    case "PENDING_REVIEW":
    case "UNDER_REVIEW":
      return "pending_review";
    case "APPROVED":
    case "SUCCESS":
      return "approved";
    case "REJECTED":
    case "FAILED":
      return "rejected";
    default:
      return null;
  }
}
