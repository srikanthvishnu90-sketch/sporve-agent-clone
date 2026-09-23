/**
 * Types for gmail-read.mjs. The module is plain JavaScript so `node --test` can
 * exercise the safety rules in CI without a Deno runtime; this file is what
 * lets the worker still type-check.
 */
export type GmailSummary = {
  message_id: string;
  thread_id: string | null;
  from_address: string | null;
  from_display: string;
  subject: string;
  snippet: string;
  received_at: string | null;
  inbound: boolean;
};
export type GmailMatch = { summary: GmailSummary; guardian: Record<string, any> };

export declare function headerValue(message: any, name: string): string | null;
export declare function senderAddress(from: string | null | undefined): string | null;
export declare function clean(text: unknown, max: number): string;
export declare function isInbound(message: any): boolean;
export declare function summarise(message: any): GmailSummary | null;
export declare function wrapUntrusted(label: string, text: unknown): string;
export declare function actionable(
  summary: GmailSummary | null,
  guardianByEmail: Map<string, any>,
): GmailMatch | null;
export declare function findingFor(
  providerId: string, connectorId: string, match: GmailMatch,
): Record<string, unknown>;
export declare function listQuery(sinceEpochSeconds: number | null): string;
