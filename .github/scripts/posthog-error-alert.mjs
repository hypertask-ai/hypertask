import { emergencyRollback } from "./emergency-rollback.mjs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { plainSummary, plainTitle } from "../../src/lib/errors/plainIncident.mjs";

function requiredConfig(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function positiveIntegerConfig(name) {
  const value = requiredConfig(name);
  if (!/^\d{1,9}$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function appUrlConfig() {
  const parsed = new URL(requiredConfig("ERROR_ALERT_APP_URL"));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("ERROR_ALERT_APP_URL must be an HTTPS origin");
  }
  return parsed.origin;
}

export function productionConfig() {
  const projectSlug = requiredConfig("ERROR_ALERT_VERCEL_PROJECT");
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(projectSlug)) {
    throw new Error("ERROR_ALERT_VERCEL_PROJECT is invalid");
  }
  return {
    appUrl: appUrlConfig(),
    boardId: positiveIntegerConfig("ERROR_ALERT_BOARD_ID"),
    bugsSectionId: positiveIntegerConfig("ERROR_ALERT_BUGS_SECTION_ID"),
    projectSlug,
  };
}
const VERCEL_API = "https://api.vercel.com";
const ROLLBACK_WINDOW_MS = 15 * 60 * 1000;
const DISPATCH_MAX_AGE_MS = 15 * 60 * 1000;

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

export function validatePostHogPayload(value, now = Date.now()) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PostHog alert payload must be an object");
  }
  const environment = value.environment;
  const alertKind = value.alert_kind;
  if (environment !== "production" && environment !== "preview") {
    throw new Error("PostHog alert environment is invalid");
  }
  const issueAlert = ["issue_created", "issue_reopened", "issue_spiking"].includes(alertKind);
  if (!issueAlert && alertKind !== "new_server_error" && alertKind !== "server_error_spike") {
    throw new Error("PostHog alert kind is invalid");
  }
  if (!issueAlert && (typeof value.release !== "string" || !/^[0-9a-f]{40}$/i.test(value.release))) {
    throw new Error("PostHog alert release is invalid");
  }
  if (typeof value.event_id !== "string" || !/^[0-9a-f-]{32,64}$/i.test(value.event_id)) {
    throw new Error("PostHog alert event id is invalid");
  }
  if (!issueAlert && (typeof value.fingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(value.fingerprint))) {
    throw new Error("PostHog alert fingerprint is invalid");
  }
  if (issueAlert) {
    if (typeof value.issue_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.issue_id)) throw new Error("PostHog issue ID is invalid");
    if (alertKind === "issue_spiking" && (!Number.isSafeInteger(value.spike_count) || value.spike_count < 1 || !Number.isFinite(value.spike_baseline) || value.spike_baseline < 0)) throw new Error("PostHog spike counts are invalid");
  } else {
    if (!Number.isInteger(value.count) || value.count < 1 || value.count > 100_000) {
      throw new Error("PostHog alert count is invalid");
    }
    if (typeof value.name !== "string" || value.name.length < 1 || value.name.length > 120) {
      throw new Error("PostHog alert name is invalid");
    }
    if (typeof value.message !== "string" || value.message.length < 1 || value.message.length > 1000) {
      throw new Error("PostHog alert message is invalid");
    }
    if (typeof value.issue_url !== "string") {
      throw new Error("PostHog issue URL is invalid");
    }
    const issueUrl = new URL(value.issue_url);
    if (issueUrl.protocol !== "https:" || !["eu.posthog.com", "us.posthog.com"].includes(issueUrl.hostname)) {
      throw new Error("PostHog issue URL host is invalid");
    }
  }
  const dispatchedAt = Date.parse(value.dispatched_at);
  if (
    !Number.isFinite(dispatchedAt) ||
    dispatchedAt < now - DISPATCH_MAX_AGE_MS ||
    dispatchedAt > now + 120_000
  ) {
    throw new Error("PostHog alert dispatch timestamp is stale");
  }
  const timestamp = Date.parse(value.timestamp);
  if (!Number.isFinite(timestamp) || timestamp > now + 120_000) {
    throw new Error("PostHog alert timestamp is invalid");
  }
  return {
    ...value,
    dispatched_at: new Date(dispatchedAt).toISOString(),
    ...(!issueAlert ? { release: value.release.toLowerCase(), fingerprint: value.fingerprint.toLowerCase() } : { issue_id: value.issue_id.toLowerCase() }),
    timestamp: new Date(timestamp).toISOString(),
  };
}

export function verifyPostHogPayloadSignature(value, secret) {
  const signature = value?.dispatch_signature;
  if (!secret || typeof signature !== "string" || !/^[0-9a-f]{64}$/i.test(signature)) {
    return false;
  }
  const canonical = JSON.stringify(
    Object.entries(value)
      .filter(([key]) => key !== "dispatch_signature")
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
  );
  const expected = createHmac("sha256", secret).update(canonical).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export async function jsonRequest(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000), ...options });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}`);
  }
  return body;
}

async function liveProduction(fetchImpl, token, config) {
  const body = await jsonRequest(
    fetchImpl,
    `${VERCEL_API}/v9/projects/${config.projectSlug}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const live = body?.targets?.production;
  if (!live?.id || !live?.createdAt || !live?.meta?.githubCommitSha) {
    throw new Error("Vercel did not return the live production deployment");
  }
  return {
    id: live.id,
    release: live.meta.githubCommitSha.toLowerCase(),
    createdAt: Number(live.createdAt),
  };
}

export function mcpHeaders(token, idempotencyKey) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
}

function incidentTitle(alert) {
  return plainTitle({ url: alert.url, message: alert.message, source: alert.source });
}

export function incidentDescription(alert) {
  return (
    `<p><strong>${escapeHtml(alert.user_impact || plainSummary({ url: alert.url, message: alert.message, source: alert.source }))}</strong></p>` +
    `<ul>` +
    `<li>Severity: ${escapeHtml(alert.severity)}. ${escapeHtml(alert.severity_reason)}</li>` +
    `<li>Production hits: ${alert.count}. Known users: ${alert.users}; ${alert.unidentified_hits} hits without a user identity.</li>` +
    `<li>First seen: ${escapeHtml(alert.timestamp)}. Last seen: ${escapeHtml(alert.last_seen)}.</li>` +
    `<li>PostHog issue ID: <code>${escapeHtml(alert.issue_id)}</code></li>` +
    `<li>Error: <code>${escapeHtml(alert.name)}</code>. ${escapeHtml(alert.message)}</li>` +
    `<li><a href="${escapeHtml(alert.issue_url)}">Open the issue in PostHog</a></li>` +
    `</ul>` +
    (alert.alert_kind === "issue_spiking" ? `<p>PostHog detected a spike: ${alert.spike_count} hits in its detection window, baseline ${alert.spike_baseline}.</p>` : "") +
    (alert.event_id ? `<p>posthog-alert:${escapeHtml(`${alert.alert_kind}:${alert.event_id}`)}</p>` : "") +
    `<p>posthog-count:${alert.count}; posthog-users:${alert.users}</p>`
  );
}

export async function createIncident(fetchImpl, mcpToken, alert, config) {
  const result = await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks/create`, {
    method: "POST",
    headers: mcpHeaders(mcpToken, `posthog-issue-${alert.issue_id}`),
    body: JSON.stringify({
      project_id: config.boardId,
      section_id: config.bugsSectionId,
      title: incidentTitle(alert),
      description: incidentDescription(alert),
      labels: [config.severityLabels[alert.severity]],
      content_type: "html",
    }),
  });
  // Create returns TaskDetail, which has ticketNumber but no uniqueIndex.
  const match = /^HTPR-([1-9][0-9]{0,8})$/.exec(result.task?.ticketNumber || "");
  const incidentNumber = match ? Number(match[1]) : NaN;
  if (
    !Number.isSafeInteger(incidentNumber) ||
    incidentNumber < 1 ||
    incidentNumber > 999_999_999
  ) {
    throw new Error("Incident response had no valid ticket number");
  }
  return {
    id: result.task.id,
    number: incidentNumber,
    url: `${config.appUrl}/detail/project-${config.boardId}/${incidentNumber}`,
  };
}

export async function handlePostHogAlert(
  rawPayload,
  {
    fetchImpl = fetch,
    rollbackImpl = emergencyRollback,
    now = Date.now(),
    vercelToken = process.env.VERCEL_TOKEN || "",
    dispatchSecret = process.env.POSTHOG_ALERT_DISPATCH_SECRET?.trim() || "",
    mcpToken = process.env.HYPERTASK_MCP_TOKEN || "",
    apiKey = process.env.POSTHOG_FULL_API_KEY || "",
    wait,
  } = {},
) {
  if (!verifyPostHogPayloadSignature(rawPayload, dispatchSecret)) {
    throw new Error("PostHog alert payload signature is invalid");
  }
  const alert = validatePostHogPayload(rawPayload, now);
  if (alert.environment === "preview") {
    return { action: "preview_verified", release: alert.release };
  }
  if (alert.alert_kind.startsWith("issue_")) {
    if (!apiKey || !mcpToken) throw new Error("PostHog issue writer credentials are missing");
    const { readProductionIssue, severityLabels, upsertIssue } = await import("./posthog-error-issues.mjs");
    const issue = await readProductionIssue(fetchImpl, apiKey, alert.issue_id, { wait });
    if (!issue) return { action: "skip", reason: "issue has no production exceptions" };
    const config = productionConfig();
    return upsertIssue(fetchImpl, mcpToken, { ...config, severityLabels: await severityLabels(fetchImpl, mcpToken, config) }, { ...alert, ...issue });
  }
  if (alert.alert_kind === "new_server_error") return { action: "rollback_not_needed" };
  if (!vercelToken) throw new Error("VERCEL_TOKEN is not configured");
  const config = productionConfig();

  const live = await liveProduction(fetchImpl, vercelToken, config);
  if (live.release !== alert.release) {
    return { action: "skip", reason: "production already serves a different release" };
  }

  const eventTime = Date.parse(alert.timestamp);
  const deploymentAge = now - live.createdAt;
  const rollbackEligible =
    alert.alert_kind === "server_error_spike" &&
    deploymentAge >= 0 &&
    deploymentAge <= ROLLBACK_WINDOW_MS &&
    eventTime >= live.createdAt &&
    eventTime - live.createdAt <= ROLLBACK_WINDOW_MS;
  let initialRollback;
  if (alert.alert_kind === "server_error_spike" && !rollbackEligible) {
    initialRollback = {
      action: "not_eligible",
      reason:
        eventTime < live.createdAt
          ? "No rollback ran because the error started before the current deployment."
          : "No rollback ran because the current deployment is older than 15 minutes.",
    };
  }
  // Only native issue alerts write tickets. Keep the signed exception path rollback-only.
  const rollback = rollbackEligible
    ? await rollbackImpl(alert.release, vercelToken, fetchImpl)
    : initialRollback;
  if (rollback?.action === "failed") throw new Error("PostHog emergency rollback failed");
  return { action: "rollback_checked", rollback };
}

async function main() {
  const payload = JSON.parse(process.env.POSTHOG_ALERT_PAYLOAD || "null");
  const result = await handlePostHogAlert(payload);
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`::error::PostHog alert failed: ${error instanceof Error ? error.message : "signature or rollback check failed"}`);
    process.exitCode = 1;
  });
}
