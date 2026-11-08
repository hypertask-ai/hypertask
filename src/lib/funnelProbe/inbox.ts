import { getRedis } from "@/lib/redis";

const PROBE_MAIL_DOMAIN = "funnel-probe.hypertask.app";
const INBOX_PREFIX = "funnel-probe:inbox:";
const INBOX_TTL_SECONDS = 48 * 60 * 60;

export type ProbeInboxEntry = {
  runId: string;
  step: "verification";
  verificationUrl: string;
  storedAt: string;
};

function emailDomain(email: string): string {
  return email.trim().toLowerCase().slice(email.lastIndexOf("@") + 1);
}

export function isProbeRecipientEmail(email: string): boolean {
  const domain = emailDomain(email);
  return domain === PROBE_MAIL_DOMAIN || domain.endsWith(`.${PROBE_MAIL_DOMAIN}`);
}

export function makeDailyProbeEmail(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 48);
  return `daily-${safe}@funnel-probe.hypertask.app`;
}

function inboxKey(normalizedEmail: string): string {
  return `${INBOX_PREFIX}${normalizedEmail}`;
}

export async function storeProbeVerificationLink(
  email: string,
  runId: string,
  verificationUrl: string,
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!isProbeRecipientEmail(normalized)) return;
  const redis = await getRedis();
  const entry: ProbeInboxEntry = {
    runId,
    step: "verification",
    verificationUrl,
    storedAt: new Date().toISOString(),
  };
  await redis.set(inboxKey(normalized), JSON.stringify(entry), "EX", INBOX_TTL_SECONDS);
}

export async function readProbeInbox(email: string): Promise<ProbeInboxEntry | null> {
  const normalized = email.trim().toLowerCase();
  if (!isProbeRecipientEmail(normalized)) return null;
  const redis = await getRedis();
  const raw = await redis.get(inboxKey(normalized));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ProbeInboxEntry;
    return typeof parsed?.verificationUrl === "string" ? parsed : null;
  } catch {
    return null;
  }
}
