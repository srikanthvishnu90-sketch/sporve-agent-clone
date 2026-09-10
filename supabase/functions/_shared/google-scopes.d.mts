/**
 * Types for google-scopes.mjs. The module is plain JavaScript so `node --test`
 * can exercise it in CI without a Deno runtime; this file is what lets the
 * edge functions still type-check, and in particular what makes isGoogleKind a
 * real type guard rather than a boolean.
 */
export type GoogleKind = 'gmail' | 'google_calendar';

export declare const GOOGLE_SCOPES: Record<GoogleKind, string[]>;
export declare const FORBIDDEN_SCOPES: string[];

export declare function assertNoSendScope(scopes: string[]): void;
export declare function isGoogleKind(v: unknown): v is GoogleKind;
export declare function authorizeUrl(
  cfg: { clientId: string; redirectUri: string },
  scopes: string[],
  state: string,
  loginHint?: string,
): string;
export declare function grantedScopes(
  token: { scope?: string } | null | undefined,
  requested: string[],
): string[];
export declare function hasRequiredRead(kind: GoogleKind, granted: string[]): boolean;
export declare function writeModeFor(kind: GoogleKind): 'none' | 'apply';
