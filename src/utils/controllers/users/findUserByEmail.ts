import prisma from "@/lib/prisma";

// HTPR-4156: Gmail ignores dots and +suffixes, so valentinyeo@gmail.com and
// valentin.yeo+work@gmail.com are one inbox. We compared raw strings, so someone
// who typed their address a different way got the magic link (same inbox), clicked
// it, and landed in a brand new empty account instead of their own.
//
// Normalise at LOOKUP only, never at storage: the address the user typed is what
// we mail and display. googlemail.com is Gmail's alternate domain for the same
// mailbox.
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function isGmailAddress(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && GMAIL_DOMAINS.has(domain);
}

/** The single inbox an address resolves to. Non-Gmail addresses are returned as-is. */
export function canonicalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!GMAIL_DOMAINS.has(domain)) return trimmed;

  const withoutSuffix = local.split("+")[0];
  return `${withoutSuffix.replace(/\./g, "")}@gmail.com`;
}

/**
 * Find the account for an address. Exact match wins, so a legacy duplicate that
 * was created before this existed still signs in to itself rather than being
 * silently merged into its dot-variant.
 *
 * ponytail: the Gmail fallback scans users on an unindexed expression. Fine at
 * this size and it only runs when the exact lookup missed. If it shows up in
 * query timings, add a stored canonicalEmail column with an index and match on
 * that instead.
 */
export async function findUserByEmail(
  email: string,
  include?: Record<string, unknown>
): Promise<any | null> {
  const args: any = include ? { include } : {};

  const exact = await prisma.user.findFirst({ where: { email }, ...args });
  if (exact) return exact;

  if (!isGmailAddress(email)) return null;

  const canonical = canonicalizeEmail(email);
  const candidates: Array<{ email: string | null }> = await prisma.user.findMany({
    where: { OR: [{ email: { endsWith: "@gmail.com" } }, { email: { endsWith: "@googlemail.com" } }] },
    ...args,
  });

  return (
    candidates.find((candidate: { email: string | null }) =>
      candidate.email ? canonicalizeEmail(candidate.email) === canonical : false
    ) ?? null
  );
}
