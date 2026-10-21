
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "mail.ru",
  "yandex.ru",
  "qq.com",
]);

export type NormalizedDomain =
  | { ok: true; domain: string }
  | { ok: false; reason: string };

export function normalizeDomain(raw: unknown): NormalizedDomain {
  if (typeof raw !== "string") {
    return { ok: false, reason: "Invalid domain entry" };
  }

  const domain = raw.trim().toLowerCase().replace(/^@/, "");

  if (!domain || domain.includes("@") || !domain.includes(".")) {
    return { ok: false, reason: `Invalid domain format: ${raw}` };
  }

  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    return { ok: false, reason: `Public email provider not allowed: ${domain}` };
  }

  return { ok: true, domain };
}

export function domainOfEmail(email: string): string | null {
  return email.split("@")[1]?.trim().toLowerCase() || null;
}
