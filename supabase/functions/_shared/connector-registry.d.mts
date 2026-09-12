/** Types for connector-registry.mjs — plain JS so `node --test` can hold the
 *  no-send rules to account in CI without a Deno runtime. */
export type WriteMode = 'none' | 'draft' | 'apply';
export type MailMode = 'none' | 'read';
export type Provider = {
  label: string; env: string[]; oauth?: boolean;
  authorize?: string; token?: string; callback: string | null;
};
export type Connector = {
  provider: string; group: string; label: string;
  write: WriteMode; mail?: MailMode; scopes?: string[];
  requiresApproval?: string; reads: string; writes: string;
};
export declare const PROVIDERS: Record<string, Provider>;
export declare const CONNECTORS: Record<string, Connector>;
export declare const FORBIDDEN_SCOPES: string[];
export declare function assertNoSendScope(scopes: string[]): void;
export declare function isKnownKind(v: unknown): boolean;
export declare function scopesFor(kind: string): string[];
export declare function providerOf(kind: string): Provider | null;
export declare function writeModeFor(kind: string): WriteMode;
export declare function availableKinds(
  env: (name: string) => string | undefined, approved?: string[]): string[];
export declare function isOAuthKind(kind: string): boolean;
