/* upstream-retry.mjs — bounded retry for IDEMPOTENT upstream model calls.
 *
 * Plain JS (no Deno APIs) so `node --test` can exercise the exact code the
 * ai-gateway ships. Used only around a call with no side effects: an Anthropic
 * Messages request that fails with 429 / 529 / 503 / 500 / a network error has
 * not produced a billable answer, so sending it again cannot double anything.
 *
 * Policy (incident 2026-10-22, docs/incidents/2026-10-22-assistant-429.md):
 *   - at most `maxAttempts` attempts (default 3),
 *   - exponential backoff with FULL jitter: delay = random(0, min(cap, base * 2^n)),
 *   - a `retry-after` header from the upstream wins over the computed delay,
 *   - never start an attempt that would push total elapsed time past
 *     `budgetMs` (default 12s) — the caller is a person watching a spinner.
 */

/** Upstream statuses that mean "busy, try again", never "your request is wrong". */
export const TRANSIENT_STATUSES = Object.freeze([408, 429, 500, 502, 503, 504, 529]);

export function isTransientStatus(status) {
  return TRANSIENT_STATUSES.includes(Number(status));
}

/** Parse a Retry-After header (delta-seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.max(0, Math.round(Number(s) * 1000));
  const at = Date.parse(s);
  if (Number.isFinite(at)) return Math.max(0, at - now);
  return null;
}

/** Full-jitter exponential backoff delay for retry number `attempt` (0-based). */
export function backoffDelay(attempt, { baseMs = 500, capMs = 4000, random = Math.random } = {}) {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}

/**
 * Run `attemptFn(attemptIndex)` until it yields a non-transient outcome.
 * `attemptFn` resolves to `{ status, retryAfter? , ...anything }` or throws on a
 * network/timeout error. Returns `{ outcome, attempts, error, retryAfterMs }`:
 *   - outcome: the last resolved value (null if every attempt threw),
 *   - error: the last thrown error (null if the last attempt resolved),
 *   - retryAfterMs: the upstream's hint (or our next delay) when we gave up on a
 *     transient failure, so the gateway can pass an honest retry_after on.
 */
export async function withUpstreamRetry(attemptFn, opts = {}) {
  const {
    maxAttempts = 3,
    budgetMs = 12_000,
    baseMs = 500,
    capMs = 4000,
    random = Math.random,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;
  const start = now();
  let outcome = null;
  let error = null;
  let retryAfterMs = null;
  let attempts = 0;
  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    let transient = false;
    retryAfterMs = null;
    try {
      outcome = await attemptFn(i);
      error = null;
      transient = isTransientStatus(outcome?.status);
      if (transient) retryAfterMs = parseRetryAfter(outcome?.retryAfter, now());
    } catch (e) {
      outcome = null;
      error = e;
      transient = true; // network failure / reset: the request produced nothing
    }
    if (!transient) return { outcome, attempts, error, retryAfterMs: null };
    if (i === maxAttempts - 1) break;
    const delay = retryAfterMs ?? backoffDelay(i, { baseMs, capMs, random });
    // A timeout that already burned the budget, or a retry-after longer than
    // the person will wait, ends here — the caller reports "busy" honestly.
    if (now() - start + delay >= budgetMs) { retryAfterMs = delay; break; }
    await sleep(delay);
  }
  return { outcome, attempts, error, retryAfterMs };
}
