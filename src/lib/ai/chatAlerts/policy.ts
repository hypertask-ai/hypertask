export const AI_CHAT_ALERT_WINDOW_MS = 15 * 60_000;
export const AI_CHAT_ALERT_MAX_ATTEMPTS = 4; // Initial delivery plus three retries.
export const AI_CHAT_ALERT_RETRY_MS = [60_000, 120_000, 240_000] as const;

export type AlertEnvironment = "production" | "preview";
export type AlertKind = "error_rate" | "latency";
export type AlertMetrics = { requestCount: number; errorCount: number; p95Ms: number };
export type AlertIncident = {
  id: string;
  kind: AlertKind;
  healthySince: Date | null;
};
export type AlertDelivery = AlertMetrics & {
  id: string;
  incidentId: string;
  environment: AlertEnvironment;
  kind: AlertKind;
  phase: "breach" | "recovery";
  happenedAt: Date;
  attemptCount: number;
};

export function isAlertBreach(kind: AlertKind, metrics: AlertMetrics) {
  if (metrics.requestCount < 20) return false;
  return kind === "error_rate"
    ? metrics.errorCount / metrics.requestCount > 0.05
    : metrics.p95Ms > 20_000;
}

export function incidentTransition(
  kind: AlertKind,
  metrics: AlertMetrics,
  incident: AlertIncident | undefined,
  now: Date,
): "open" | "breaching" | "healthy" | "recover" | "none" {
  if (isAlertBreach(kind, metrics)) return incident ? "breaching" : "open";
  if (!incident) return "none";
  // The minimum volume applies to opening, not to hiding an ongoing breach.
  if (metrics.requestCount > 0 && (
    kind === "error_rate"
      ? metrics.errorCount / metrics.requestCount > 0.05
      : metrics.p95Ms > 20_000
  )) return "breaching";
  return incident.healthySince &&
    now.getTime() - incident.healthySince.getTime() >= AI_CHAT_ALERT_WINDOW_MS
    ? "recover"
    : "healthy";
}

export function alertMessage(delivery: AlertDelivery) {
  const metric = delivery.kind === "error_rate" ? "error rate" : "p95 latency";
  const state = delivery.phase === "breach" ? "breached its threshold" : "recovered for a full 15-minute window";
  return `AI Chat ${metric} ${state} in ${delivery.environment}. ` +
    `Last 15 minutes: ${delivery.requestCount} requests, ${delivery.errorCount} errors, ` +
    `p95 ${(delivery.p95Ms / 1000).toFixed(1)}s. Incident ${delivery.incidentId}. ` +
    `Observed at ${delivery.happenedAt.toISOString()}.`;
}
