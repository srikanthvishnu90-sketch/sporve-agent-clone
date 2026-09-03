import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DIRECT_CHARGE_WEBHOOK_EVENTS,
  PLATFORM_WEBHOOK_EVENTS,
} from "../_shared/stripe_webhook_events.ts";

Deno.test("Connect endpoint receives the six direct-charge lifecycle events", () => {
  assertEquals([...DIRECT_CHARGE_WEBHOOK_EVENTS], [
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
    "checkout.session.async_payment_failed",
    "checkout.session.expired",
    "charge.refunded",
    "payment_intent.payment_failed",
  ]);
});

Deno.test("platform endpoint also receives every billing event the handler consumes", () => {
  assertEquals([...PLATFORM_WEBHOOK_EVENTS], [
    ...DIRECT_CHARGE_WEBHOOK_EVENTS,
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
  ]);
});
