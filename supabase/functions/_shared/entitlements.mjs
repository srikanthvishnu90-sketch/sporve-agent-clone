/**
 * Converts only the reviewed database entitlement signal into the public 402
 * response. Database/network/auth failures intentionally stay with their
 * normal callers rather than being mislabeled as a paywall.
 */
export function entitlementLimitResponse(error) {
  if (!error || error.code !== "PT402") return null;
  let body;
  try {
    body = typeof error.details === "string" ? JSON.parse(error.details) : error.details;
  } catch {
    return null;
  }
  const isSlug = (value) => typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
  const isReason = (value) => typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
  const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
  if (!body || typeof body !== "object" ||
      !isReason(body.reason) || !isSlug(body.current_plan) ||
      !Object.hasOwn(body, "upgrade_to") ||
      !(body.upgrade_to === null || isSlug(body.upgrade_to)) ||
      !isCount(body.limit) || !isCount(body.current)) return null;
  return {
    status: 402,
    body: {
      reason: body.reason,
      current_plan: body.current_plan,
      upgrade_to: body.upgrade_to,
      limit: body.limit,
      current: body.current,
    },
  };
}
