export class HttpInputError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Bounds response time even if a downstream transport ignores cancellation. */
export async function withHttpDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => work(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new HttpInputError(504, 'Request took too long. Please try again.');
          reject(error); controller.abort(error);
        }, ms);
      }),
    ]);
  } finally { clearTimeout(timer); controller.abort(); }
}

/** Reads raw text without allowing a chunked request to grow memory without bound. */
export async function readBoundedText(
  req: Request | Response,
  maxBytes = 100_000,
  signal?: AbortSignal,
): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    void req.body?.cancel().catch(() => {});
    throw new HttpInputError(413, "Request is too large.");
  }
  if (!req.body) return "";

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new HttpInputError(413, "Request is too large.");
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel); cancel(); reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** JSON consumers share the same byte, stream and cancellation limits. */
export async function readBoundedJson(
  req: Request | Response,
  maxBytes = 100_000,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const text = await readBoundedText(req, maxBytes, signal);
  try {
    const parsed = JSON.parse(text || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpInputError(400, "Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpInputError) throw error;
    throw new HttpInputError(400, "Request body must be valid JSON.");
  }
}
