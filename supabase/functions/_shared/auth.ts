import { createClient } from "npm:@supabase/supabase-js@2";

export type ValidatedCaller = {
  userId: string | null;
  isService: boolean;
};

/**
 * Validate a bearer token before a function uses a service-role client.
 * Merely forwarding an Authorization header to another function is not enough:
 * cache hits and early database reads can otherwise happen before validation.
 */
export async function validateCaller(
  authHeader: string,
  supabaseUrl: string,
  anonKey: string,
  serviceRoleKey?: string,
): Promise<ValidatedCaller | null> {
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  if (serviceRoleKey && bearer === serviceRoleKey) {
    return { userId: null, isService: true };
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { userId: data.user.id, isService: false };
}
