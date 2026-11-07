import { getRedis } from "@/lib/redis";
import { isProbeRecipientEmail } from "@/lib/funnelProbe/probeEmail";

const INBOX_PREFIX = "funnel-probe:inbox:";
const INBOX_TTL_SECONDS = 48 * 60 * 60;

export type ProbeInboxEntry = {
  runId: string;
  step: "verification";
  verificationUrl: string;
  storedAt: string;
};

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
  await redis.set(
    inboxKey(normalized),
    JSON.stringify(entry),
    "EX",
    INBOX_TTL_SECONDS,
  );
}

export async function readProbeInbox(
  email: string,
): Promise<ProbeInboxEntry | null> {
  const normalized = email.trim().toLowerCase();
  if (!isProbeRecipientEmail(normalized)) return null;
  const redis = await getRedis();
  const raw = await redis.get(inboxKey(normalized));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ProbeInboxEntry;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.verificationUrl === "string"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export function redactProbeInboxForAlert(
  entry: ProbeInboxEntry | null,
): { runId: string; step: string; hasVerificationLink: boolean } | null {
  if (!entry) return null;
  return {
    runId: entry.runId,
    step: entry.step,
    hasVerificationLink: Boolean(entry.verificationUrl),
  };
}
