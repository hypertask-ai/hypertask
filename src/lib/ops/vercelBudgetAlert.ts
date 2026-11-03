import { createHmac, timingSafeEqual } from "node:crypto";
import { escapeHtml } from "@/utils/htmlEscape";

export interface VercelBudgetAlert {
  budgetAmount: number;
  currentSpend: number;
  thresholdPercent: number;
  teamId: string;
  budgetScope: string;
}

const SIGNATURE_PATTERN = /^[a-f0-9]{40}$/i;
const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SCOPE_PATTERN = /^[a-z][a-z0-9 _-]{0,63}$/i;

function money(amount: number) {
  return `$${amount.toFixed(2)}`;
}

function readAmount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value > 100_000_000 ? null : Math.round(value * 100) / 100;
}

export function verifyVercelSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  signingSecret: string | undefined,
): boolean {
  if (!signingSecret || !signatureHeader || !SIGNATURE_PATTERN.test(signatureHeader)) {
    return false;
  }
  const expected = createHmac("sha1", signingSecret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqual(
    Buffer.from(signatureHeader.toLowerCase(), "utf8"),
    Buffer.from(expected, "utf8"),
  );
}

export function parseVercelBudgetAlert(payload: unknown): VercelBudgetAlert | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const budgetAmount = readAmount(record.budgetAmount);
  const currentSpend = readAmount(record.currentSpend);
  const thresholdPercent = record.thresholdPercent;
  const teamId = record.teamId;
  const scope = record.budgetScope ?? record.scope;

  if (budgetAmount === null || budgetAmount <= 0 || currentSpend === null) return null;
  if (
    typeof thresholdPercent !== "number" ||
    !Number.isInteger(thresholdPercent) ||
    thresholdPercent < 1 ||
    thresholdPercent > 1000
  ) {
    return null;
  }
  if (typeof teamId !== "string" || !TEAM_ID_PATTERN.test(teamId)) return null;

  return {
    budgetAmount,
    currentSpend,
    thresholdPercent,
    teamId,
    budgetScope: typeof scope === "string" && SCOPE_PATTERN.test(scope) ? scope : "team budget",
  };
}

function scopeSlug(alert: VercelBudgetAlert) {
  return alert.budgetScope.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function budgetAlertMarker(alert: VercelBudgetAlert) {
  return `vercel-budget-alert:team:${alert.teamId}:budget:${alert.budgetAmount}:threshold:${alert.thresholdPercent}:scope:${scopeSlug(alert)}`;
}

export function budgetAlertTitle(alert: VercelBudgetAlert) {
  return `Vercel ${alert.budgetScope} at ${alert.thresholdPercent}%: ${money(alert.currentSpend)} of ${money(alert.budgetAmount)}`;
}

export function budgetAlertDescription(alert: VercelBudgetAlert) {
  const remaining = Math.max(0, Math.round((alert.budgetAmount - alert.currentSpend) * 100) / 100);
  return [
    `<p><strong>Vercel sent a budget alert.</strong></p>`,
    `<p>Limit: ${escapeHtml(alert.budgetScope)} reached ${alert.thresholdPercent}%.</p>`,
    `<p>Spent so far: ${money(alert.currentSpend)} of ${money(alert.budgetAmount)}.</p>`,
    `<p>Budget left: ${money(remaining)}.</p>`,
    `<p>Vercel team: ${escapeHtml(alert.teamId)}.</p>`,
    `<p>Budgets: <a href="https://vercel.com/dashboard">https://vercel.com/dashboard</a></p>`,
    `<p>${budgetAlertMarker(alert)}</p>`,
  ].join("");
}

export function budgetAlertMarkerHtml(alert: VercelBudgetAlert) {
  return `<p>${budgetAlertMarker(alert)}</p>`;
}

export function budgetAlertSubject(alert: VercelBudgetAlert) {
  return `Hypertask: Vercel ${alert.budgetScope} at ${alert.thresholdPercent}%`;
}
