export const DIRECT_CHARGE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "charge.refunded",
  "payment_intent.payment_failed",
] as const;

export const PLATFORM_WEBHOOK_EVENTS = [
  ...DIRECT_CHARGE_WEBHOOK_EVENTS,
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;
