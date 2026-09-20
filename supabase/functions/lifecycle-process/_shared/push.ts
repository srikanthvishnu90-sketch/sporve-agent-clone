// ============================================================================
// _shared/push.ts — best-effort FCM (HTTP v1) push delivery. (Phase B1)
// ============================================================================
// deliverPush(admin, userId, title, body) sends a push to every device the user
// has registered in `push_tokens`, using a Firebase service account (HTTP v1).
// Dead tokens (UNREGISTERED / invalid) are pruned. Everything is wrapped so a
// push failure NEVER breaks the caller (the inbox notification already landed).
//
// Requires the Edge Function secret FCM_SERVICE_ACCOUNT = the full service
// account JSON (one line). No-op (logs) if it's missing.
// ============================================================================

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

let _cachedToken: { token: string; exp: number } | null = null;

function b64url(bytes: Uint8Array | string): string {
  const bin = typeof bytes === "string"
    ? bytes
    : String.fromCharCode(...bytes);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && _cachedToken.exp - 60 > now) return _cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;

  // Import the PEM (pkcs8) private key and RS256-sign the JWT.
  const pem = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsigned),
    ),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const j = await resp.json();
  if (!resp.ok || !j.access_token) {
    throw new Error(`FCM token exchange failed: ${JSON.stringify(j)}`);
  }
  _cachedToken = { token: j.access_token, exp: now + 3600 };
  return j.access_token;
}

/// Sends a push to all of a user's registered devices. Never throws.
export async function deliverPush(
  admin: SupabaseClient,
  userId: string,
  title: string,
  body: string,
): Promise<void> {
  try {
    const raw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!raw) {
      console.log("deliverPush: FCM_SERVICE_ACCOUNT not set — skipping push");
      return;
    }
    const sa = JSON.parse(raw) as ServiceAccount;

    const { data: tokens } = await admin
      .from("push_tokens")
      .select("token")
      .eq("user_id", userId);
    if (!tokens || tokens.length === 0) return;

    const accessToken = await getAccessToken(sa);
    const url =
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    for (const row of tokens) {
      const token = (row as { token: string }).token;
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              webpush: { fcm_options: { link: "/" } },
            },
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          // Prune dead tokens so we stop trying them.
          if (
            resp.status === 404 ||
            errText.includes("UNREGISTERED") ||
            errText.includes("INVALID_ARGUMENT")
          ) {
            await admin.from("push_tokens").delete().eq("token", token);
          }
          console.error(`deliverPush ${resp.status}: ${errText}`);
        }
      } catch (e) {
        console.error("deliverPush per-token error:", (e as Error).message);
      }
    }
  } catch (e) {
    console.error("deliverPush failed:", (e as Error).message);
  }
}
