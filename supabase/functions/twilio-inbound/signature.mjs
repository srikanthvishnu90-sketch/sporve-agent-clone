// ============================================================================
// twilio-inbound / signature.mjs — pure Twilio request-signature validator
// ============================================================================
// Twilio signs every webhook: signature = base64(HMAC-SHA1(authToken,
// fullUrl + params sorted by key concatenated)). See
// https://www.twilio.com/docs/usage/security
//
// Pure module: no Deno or Node-only deps (uses globalThis.crypto.subtle and
// btoa, present in both), so it unit-tests in plain Node and imports cleanly
// from the edge function.
// ============================================================================

/** The exact string Twilio signs: full request URL, then params sorted by key. */
export function signatureBaseString(url, params) {
  const keys = Object.keys(params).sort();
  let s = String(url);
  for (const k of keys) s += k + String(params[k]);
  return s;
}

/** base64(HMAC-SHA1(authToken, baseString)). */
export async function twilioSignature(authToken, url, params) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signatureBaseString(url, params)),
  );
  const bytes = new Uint8Array(sig);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Timing-safe comparison of the computed signature against the
 * X-Twilio-Signature header. False on any mismatch or missing input —
 * a forged/unsigned request is never accepted.
 */
export async function validTwilioSignature(authToken, url, params, header) {
  if (!authToken || typeof header !== "string" || !header) return false;
  const expected = await twilioSignature(authToken, url, params);
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  }
  return diff === 0;
}
