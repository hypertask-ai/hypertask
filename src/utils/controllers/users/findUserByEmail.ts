import prisma from "@/lib/prisma";

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function isGmailAddress(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && GMAIL_DOMAINS.has(domain);
}

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
