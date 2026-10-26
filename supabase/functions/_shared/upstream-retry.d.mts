/** Types for upstream-retry.mjs — plain JS so `node --test` runs the shipped code. */
export declare const TRANSIENT_STATUSES: readonly number[];
export declare function isTransientStatus(status: unknown): boolean;
export declare function parseRetryAfter(value: unknown, now?: number): number | null;
export declare function backoffDelay(
  attempt: number,
  opts?: { baseMs?: number; capMs?: number; random?: () => number },
): number;
export type RetryOutcome<T> = {
  outcome: T | null;
  attempts: number;
  error: unknown;
  retryAfterMs: number | null;
};
export declare function withUpstreamRetry<T extends { status?: number; retryAfter?: string | null }>(
  /** timeoutMs = full attemptTimeoutMs on the first attempt, min(attemptTimeoutMs, remainingMs) on retries. */
  attemptFn: (attempt: number, ctx: { remainingMs: number; timeoutMs: number }) => Promise<T>,
  opts?: {
    maxAttempts?: number; budgetMs?: number; attemptTimeoutMs?: number; baseMs?: number; capMs?: number;
    random?: () => number; now?: () => number; sleep?: (ms: number) => Promise<unknown>;
  },
): Promise<RetryOutcome<T>>;
