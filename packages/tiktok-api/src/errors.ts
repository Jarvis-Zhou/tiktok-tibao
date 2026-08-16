export interface TikTokApiErrorOptions {
  code: string;
  httpStatus: number;
  requestId?: string | undefined;
  retryable?: boolean;
  cause?: unknown;
}

export class TikTokApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly requestId: string | undefined;
  readonly retryable: boolean;

  constructor(message: string, options: TikTokApiErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "TikTokApiError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? (options.httpStatus === 429 || options.httpStatus >= 500);
  }
}
