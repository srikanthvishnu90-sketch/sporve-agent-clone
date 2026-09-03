// Stripe combines the connected account prefix, "* ", and this suffix into a
// 22-character card descriptor. Account prefixes can use 10 characters, so a
// 10-character suffix is the longest value that is safe for every account.
const MAX_SAFE_SUFFIX_LENGTH = 10;
const FORBIDDEN = /[<>'"*\\]/g;
const UNSUPPORTED = /[^A-Z0-9 .,&-]/g;

export function stripeStatementDescriptorSuffix(
  businessName: string | null | undefined,
): string {
  const normalized = (businessName ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(FORBIDDEN, "")
    .replace(UNSUPPORTED, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SAFE_SUFFIX_LENGTH)
    .trim();

  // Stripe requires at least one Latin letter in a descriptor.
  return /[A-Z]/.test(normalized) ? normalized : "CLUB";
}
