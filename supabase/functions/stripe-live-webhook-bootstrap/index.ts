// One-shot live webhook bootstrap.
//
// Deploy only after STRIPE_SECRET_KEY is a live standard secret key. Invoke once
// with the nonce header and confirmation body, set the two returned signing
// secrets, then delete this function and unset ADMIN_SETUP_NONCE.
import Stripe from "npm:stripe@14.21.0";
import { HttpInputError, readBoundedJson } from "../_shared/http.ts";
import {
  DIRECT_CHARGE_WEBHOOK_EVENTS,
  PLATFORM_WEBHOOK_EVENTS,
} from "../_shared/stripe_webhook_events.ts";

const WEBHOOK_URL =
  "https://tseszaprvtvqrkfpditu.supabase.co/functions/v1/stripe-webhook";
const API_VERSION = "2024-06-20";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

async function nonceMatches(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const secretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!secretKey.startsWith("sk_live_")) {
    return json(
      { error: "Bootstrap requires a standard Stripe live secret key." },
      503,
    );
  }

  const expectedNonce = Deno.env.get("ADMIN_SETUP_NONCE") ?? "";
  const providedNonce = req.headers.get("x-admin-setup-nonce") ?? "";
  if (
    expectedNonce.length < 32 ||
    !(await nonceMatches(providedNonce, expectedNonce))
  ) {
    return json({ error: "Forbidden." }, 403);
  }

  try {
    const body = await readBoundedJson(req, 1_024);
    if (body.confirm !== "CREATE_LIVE_STRIPE_WEBHOOKS") {
      return json(
        { error: "Confirmation phrase is missing or incorrect." },
        400,
      );
    }

    const stripe = new Stripe(secretKey, {
      apiVersion: API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });

    // A retry after a lost response must stop: Stripe reveals signing secrets
    // only at creation, so silently accepting existing endpoints would produce
    // an unusable cutover.
    const existing = await stripe.webhookEndpoints.list({ limit: 100 });
    const atTarget = existing.data.filter((endpoint) =>
      endpoint.url === WEBHOOK_URL
    );
    if (atTarget.length > 0) {
      return json({
        error:
          "A live webhook endpoint already targets this URL; inspect it before retrying.",
        existing_endpoint_ids: atTarget.map((endpoint) => endpoint.id),
      }, 409);
    }

    let platform: Stripe.WebhookEndpoint | null = null;
    let connect: Stripe.WebhookEndpoint | null = null;
    try {
      platform = await stripe.webhookEndpoints.create({
        url: WEBHOOK_URL,
        enabled_events: [...PLATFORM_WEBHOOK_EVENTS],
        connect: false,
        description: "Sporv live platform webhook",
        api_version: API_VERSION,
      });
      connect = await stripe.webhookEndpoints.create({
        url: WEBHOOK_URL,
        enabled_events: [...DIRECT_CHARGE_WEBHOOK_EVENTS],
        connect: true,
        description: "Sporv live Connect direct-charge webhook",
        api_version: API_VERSION,
      });
      if (!platform.secret || !connect.secret) {
        throw new Error("Stripe did not return both signing secrets.");
      }
    } catch (error) {
      // Avoid leaving a half-configured live endpoint when the second create or
      // one-time-secret response fails.
      if (connect?.id) {
        await stripe.webhookEndpoints.del(connect.id).catch(() => undefined);
      }
      if (platform?.id) {
        await stripe.webhookEndpoints.del(platform.id).catch(() => undefined);
      }
      throw error;
    }

    // Never console.log this response: each secret is available only once.
    return json({
      webhook_url: WEBHOOK_URL,
      platform: {
        endpoint_id: platform.id,
        signing_secret: platform.secret,
      },
      connect: {
        endpoint_id: connect.id,
        signing_secret: connect.secret,
      },
      next:
        "Set STRIPE_WEBHOOK_SECRET and STRIPE_CONNECT_WEBHOOK_SECRET, deploy stripe-webhook, then delete this function and unset ADMIN_SETUP_NONCE.",
    });
  } catch (error) {
    if (error instanceof HttpInputError) {
      return json({ error: error.message }, error.status);
    }
    console.error("live webhook bootstrap failed:", (error as Error).message);
    return json({ error: "Live webhook bootstrap failed." }, 500);
  }
});
