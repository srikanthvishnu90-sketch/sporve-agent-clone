export class HttpInputError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Reads JSON without allowing a chunked request to grow memory without bound. */
export async function readBoundedJson(
  req: Request,
  maxBytes = 100_000,
): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpInputError(413, "Request is too large.");
  }
  if (!req.body) return {};

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new HttpInputError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpInputError(400, "Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpInputError) throw error;
    throw new HttpInputError(400, "Request body must be valid JSON.");
  }
}
