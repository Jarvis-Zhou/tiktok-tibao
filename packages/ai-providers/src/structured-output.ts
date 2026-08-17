import { VideoDomainError, sha256Fingerprint } from "@tibao/video-core";

export interface StructuredRepairContext {
  attempt: number;
  errorCode: string;
  errorMessage: string;
  inputHash: string;
}
export type StructuredRepair = (
  invalidValue: unknown,
  context: StructuredRepairContext,
  signal: AbortSignal,
) => Promise<unknown>;

export interface ValidatedStructuredOutput<T> {
  value: T;
  repairAttempts: number;
  inputHash: string;
  outputHash: string;
}

export async function validateStructuredOutput<T>(input: {
  value: unknown;
  validate(value: unknown): asserts value is T;
  repair?: StructuredRepair;
  signal: AbortSignal;
  maxRepairAttempts?: number;
}): Promise<ValidatedStructuredOutput<T>> {
  const maxAttempts = Math.max(0, Math.min(2, input.maxRepairAttempts ?? 2));
  const inputHash = sha256Fingerprint(input.value);
  let value = input.value;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    if (input.signal.aborted) {
      const error = new Error("Structured output validation aborted");
      error.name = "AbortError";
      throw error;
    }
    try {
      input.validate(value);
      return {
        value,
        repairAttempts: attempt,
        inputHash,
        outputHash: sha256Fingerprint(value),
      };
    } catch (error) {
      lastError = error;
      if (!input.repair || attempt === maxAttempts) break;
      const domainError = error instanceof VideoDomainError
        ? error
        : new VideoDomainError({ code: "BLUEPRINT_SCHEMA_INVALID", message: "Structured output validation failed" });
      value = await input.repair(value, {
        attempt: attempt + 1,
        errorCode: domainError.code,
        errorMessage: domainError.message,
        inputHash,
      }, input.signal);
    }
  }
  if (lastError instanceof VideoDomainError) throw lastError;
  throw new VideoDomainError({
    code: "BLUEPRINT_SCHEMA_INVALID",
    message: "Structured output remained invalid after two repair attempts",
    statusCode: 422,
  });
}
