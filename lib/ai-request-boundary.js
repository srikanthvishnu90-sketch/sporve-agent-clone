/** Limits caller-visible time even when a transport ignores abort. */
export async function withDeadline(work, ms) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('Upstream deadline exceeded');
          error.name = 'DeadlineError';
          reject(error); controller.abort(error);
        }, ms);
      }),
    ]);
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Read the quota response as bounded UTF-8 bytes, including chunked bodies. */
export async function readQuotaResponse(response, signal, maxBytes = 16_384) {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new Error('Quota response too large');
  }
  if (!response.body) throw new Error('Missing quota response');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, {once:true});
  let bytes = 0, body = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      signal.throwIfAborted();
      const {done,value} = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Quota response too large');
      body += decoder.decode(value, {stream:true});
    }
    return JSON.parse(body + decoder.decode());
  } finally {
    signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock();
  }
}

/** Configuration is environment-only; never fall back to another project. */
export function quotaConfig(env) {
  const key = env.SUPABASE_ANON_KEY?.trim();
  if (!key) return null;
  try {
    const url = new URL(env.SUPABASE_URL || '');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || url.port) return null;
    return {url:url.origin, key};
  } catch { return null; }
}

/** Unknown authorization shapes must never become permission to spend. */
export function validQuota(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.allowed !== 'boolean') return false;
  if (value.allowed) {
    if (typeof value.plan !== 'string' || !value.plan.trim() || value.plan.length > 80 ||
      Object.hasOwn(value, 'reason')) return false;
    if (value.quota === null) {
      return !Object.hasOwn(value, 'used') || (Number.isSafeInteger(value.used) && value.used >= 1);
    }
    return Number.isSafeInteger(value.quota) && value.quota >= 1 &&
      Number.isSafeInteger(value.used) && value.used >= 1 && value.used <= value.quota;
  }
  if (['not_authenticated','not_a_coach','quota_unavailable'].includes(value.reason)) return true;
  if (value.reason === 'rate_limited') {
    return Number.isSafeInteger(value.retry_after) && value.retry_after >= 1 && value.retry_after <= 60;
  }
  if (value.reason === 'quota_exhausted') {
    if (Object.hasOwn(value, 'contract_version')) {
      const slug = v => typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v);
      if (value.contract_version !== 2 || !slug(value.current_plan) ||
        !(value.upgrade_to === null || slug(value.upgrade_to)) ||
        value.limit !== value.quota || value.current !== value.used) return false;
    }
    return Number.isSafeInteger(value.used) && value.used >= 0 &&
      Number.isSafeInteger(value.quota) && value.quota >= 0 && value.used >= value.quota;
  }
  return false;
}
