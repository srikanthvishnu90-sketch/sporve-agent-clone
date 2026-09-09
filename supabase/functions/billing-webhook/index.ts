// Prompt 1 platform Billing endpoint. Not deployed until the independent
// apply_platform_billing_event RPC, customer/price mappings and endpoint signing
// secret are installed and reviewed. No dues/Connect imports or ledger writes.
import Stripe from 'npm:stripe@14.21.0';
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { createBillingWebhook } from './handler.mjs';

const secretKey = Deno.env.get('STRIPE_BILLING_SECRET_KEY');
const webhookSecret = Deno.env.get('STRIPE_BILLING_WEBHOOK_SECRET');
const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const mode = Deno.env.get('STRIPE_BILLING_MODE');
if (!secretKey || !webhookSecret || !url || !serviceKey || !['test', 'live'].includes(mode ?? '')) {
  Deno.serve((req: Request) => new Response(JSON.stringify({ error:
    req.headers.get('stripe-signature') ? 'Billing is not configured.' : 'Webhook signature required.' }),
  { status: req.headers.get('stripe-signature') ? 503 : 401,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }));
} else {
  const stripe = new Stripe(secretKey, {
    apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 0, timeout: 8000,
  });
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  Deno.serve(createBillingWebhook({
    livemode: mode === 'live',
    verify: (raw: string, signature: string) => stripe.webhooks.constructEventAsync(
      raw, signature, webhookSecret, 300, Stripe.createSubtleCryptoProvider()),
    loadSubscription: (id: string) => stripe.subscriptions.retrieve(id),
    apply: async (event: Record<string, unknown>, signal: AbortSignal) => {
      const { data, error } = await admin.rpc('apply_platform_billing_event', { p_event: event }).abortSignal(signal);
      if (error) throw new Error('Billing projection unavailable');
      return data;
    },
  }));
}
