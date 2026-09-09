import { entitlementLimitResponse as parseEntitlementLimit } from "./entitlements.mjs";

export type EntitlementLimit = {
  reason: string;
  current_plan: string;
  upgrade_to: string | null;
  limit: number;
  current: number;
};

/** Return a 402 payload only for a validated PT402 database error. */
export function entitlementLimitResponse(error: unknown): { status: 402; body: EntitlementLimit } | null {
  return parseEntitlementLimit(error) as { status: 402; body: EntitlementLimit } | null;
}
