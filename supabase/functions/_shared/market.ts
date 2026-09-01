// ============================================================================
// _shared/market.ts — the market-readiness GATE for the search layer
// ============================================================================
// The search Edge Function MUST call isMarketReady(admin, sport, metro) before
// running any discovery in a (sport × metro) market. It wraps the server-side
// is_market_ready() gate (config floors + admin force_ready override), which is
// service-role only — so pass a SERVICE-ROLE Supabase client. Fails CLOSED:
// any error returns false (a market is never "ready" by accident).
//
// metroKey() mirrors the SQL public.metro_key() derivation so the caller can
// compute the same coarse metro bucket client/server-side when needed.
// ============================================================================

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Coarse, deterministic metro bucket — mirrors SQL public.metro_key(). */
export function metroKey(
  lat?: number | null, lng?: number | null, city?: string | null, state?: string | null,
): string {
  if (lat != null && lng != null) {
    const b = (n: number) => (Math.floor(n * 2) / 2).toFixed(1);
    return `geo:${b(lat)},${b(lng)}`;
  }
  const c = (city ?? "").trim();
  if (c) return `${c.toLowerCase()},${(state ?? "").trim().toLowerCase()}`;
  return "unknown";
}

/**
 * The gate. Returns true only if the market has earned search (or an admin
 * override forces it). Pass a service-role client. Fails closed on any error.
 */
export async function isMarketReady(
  admin: SupabaseClient, sport: string, metro: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("is_market_ready", { p_sport: sport, p_metro: metro });
    if (error) {
      console.error("isMarketReady rpc error:", error.message);
      return false; // fail closed
    }
    return data === true;
  } catch (e) {
    console.error("isMarketReady threw:", (e as Error).message);
    return false; // fail closed
  }
}
