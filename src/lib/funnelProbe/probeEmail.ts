const PROBE_MAIL_DOMAIN = "funnel-probe.hypertask.app";

function emailDomain(email: string): string {
  return email.trim().toLowerCase().slice(email.lastIndexOf("@") + 1);
}

function isWithinDomain(domain: string, parent: string): boolean {
  return domain === parent || domain.endsWith(`.${parent}`);
}

export function isProbeRecipientEmail(email: string): boolean {
  const domain = emailDomain(email);
  return isWithinDomain(domain, PROBE_MAIL_DOMAIN);
}

export const FUNNEL_PROBE_INVITE_EMAIL = "invite@funnel-probe.hypertask.app";

export function makeDailyProbeEmail(runId: string): string {
  const safe = runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 48);
  return `daily-${safe}@funnel-probe.hypertask.app`;
}
