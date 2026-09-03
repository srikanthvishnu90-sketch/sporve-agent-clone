import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertStripeEventMode,
  stripeModeFromSecret,
} from "../_shared/stripe_mode.ts";

Deno.test("Stripe mode is derived explicitly from secret-key prefixes", () => {
  assertEquals(stripeModeFromSecret("sk_test_dummy"), "test");
  assertEquals(stripeModeFromSecret("rk_test_dummy"), "test");
  assertEquals(stripeModeFromSecret("sk_live_dummy"), "live");
  assertEquals(stripeModeFromSecret("rk_live_dummy"), "live");
  assertThrows(() => stripeModeFromSecret("not-a-stripe-key"));
});

Deno.test("webhook rejects a live event under a test key", () => {
  assertThrows(
    () => assertStripeEventMode(true, "sk_test_dummy"),
    Error,
    "expected test mode, received live mode",
  );
});

Deno.test("webhook rejects a test event under a live key", () => {
  assertThrows(
    () => assertStripeEventMode(false, "sk_live_dummy"),
    Error,
    "expected live mode, received test mode",
  );
});

Deno.test("webhook accepts events only in the configured mode", () => {
  assertStripeEventMode(false, "sk_test_dummy");
  assertStripeEventMode(true, "sk_live_dummy");
});
