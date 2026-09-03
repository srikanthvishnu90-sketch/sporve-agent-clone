export type StripeMode = "live" | "test";

export function stripeModeFromSecret(secretKey: string): StripeMode {
  if (/^(?:sk|rk)_live_/.test(secretKey)) return "live";
  if (/^(?:sk|rk)_test_/.test(secretKey)) return "test";
  throw new Error(
    "STRIPE_SECRET_KEY must be a Stripe test or live secret key.",
  );
}

export function assertStripeEventMode(
  eventLivemode: boolean,
  secretKey: string,
): void {
  const expected = stripeModeFromSecret(secretKey);
  const received: StripeMode = eventLivemode ? "live" : "test";
  if (received !== expected) {
    throw new Error(
      `Stripe event mode mismatch: expected ${expected} mode, received ${received} mode`,
    );
  }
}
