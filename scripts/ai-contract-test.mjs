import assert from "node:assert/strict";
import handler, { normalizeAction } from "../api/ai.js";

let requestNumber = 0;

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    },
  };
}

async function invoke({ method = "POST", contentType = "application/json", origin = "https://sporv.test", body = {} } = {}) {
  requestNumber += 1;
  const req = {
    method,
    headers: {
      host: "sporv.test",
      origin,
      "content-type": contentType,
      "x-forwarded-for": "192.0.2." + requestNumber,
    },
    socket: { remoteAddress: "127.0.0.1" },
    body,
  };
  const res = responseRecorder();
  await handler(req, res);
  return res;
}

const previousKey = process.env.ANTHROPIC_API_KEY;
process.env.ANTHROPIC_API_KEY = "contract-test-only";

try {
  let res = await invoke({ method: "GET" });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, "POST");

  res = await invoke({ contentType: "application/jsonp", body: { text: "open earnings" } });
  assert.equal(res.statusCode, 415);

  res = await invoke({ contentType: "application/json; charset=utf-8", body: {} });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, "empty_text");

  res = await invoke({ origin: "https://evil.example", body: { text: "open earnings" } });
  assert.equal(res.statusCode, 403);

  const multibyteGroups = Array.from({ length: 50 }, () => "界".repeat(60));
  res = await invoke({ body: { text: "open earnings", groups: multibyteGroups } });
  assert.equal(res.statusCode, 413);
  assert.equal(res.payload.error, "payload_too_large");

  assert.deepEqual(normalizeAction({
    action: "open_tab",
    target: "finances",
    body: "",
    restated: "Open finances.",
    ignored: "must not cross the server boundary",
  }), {
    action: "open_tab",
    target: "finances",
    body: "",
    restated: "Open finances.",
  });
  assert.deepEqual(normalizeAction({
    action: "send_group_message",
    target: ["not", "a", "string"],
    body: "Practice moved.",
    restated: "Send the update.",
  }), { action: "unknown", target: "", body: "", restated: "" });
  assert.deepEqual(normalizeAction({
    action: "unknown",
    target: "everyone",
    body: "content that must be discarded",
    restated: "Do something unsupported.",
  }), { action: "unknown", target: "", body: "", restated: "" });

  delete process.env.ANTHROPIC_API_KEY;
  res = await invoke({ body: { text: "open earnings" } });
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.error, "ai_not_configured");
} finally {
  if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousKey;
}

console.log("AI contract: 9 assertions passed");
