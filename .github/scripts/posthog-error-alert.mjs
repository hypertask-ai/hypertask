import { emergencyRollback } from "./emergency-rollback.mjs";
import { createHmac, timingSafeEqual } from "node:crypto";

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

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function productionConfig() {
  const managerAgentId = requiredConfig("ERROR_ALERT_MANAGER_AGENT_ID");
  if (!isUuid(managerAgentId)) {
    throw new Error("ERROR_ALERT_MANAGER_AGENT_ID is invalid");
  }
  const projectSlug = requiredConfig("ERROR_ALERT_VERCEL_PROJECT");
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(projectSlug)) {
    throw new Error("ERROR_ALERT_VERCEL_PROJECT is invalid");
  }
  return {
    appUrl: appUrlConfig(),
    boardId: positiveIntegerConfig("ERROR_ALERT_BOARD_ID"),
    bugsSectionId: positiveIntegerConfig("ERROR_ALERT_BUGS_SECTION_ID"),
    managerThread: positiveIntegerConfig("ERROR_ALERT_MANAGER_THREAD"),
    managerAgentId,
    projectSlug,
  };
}
const VERCEL_API = "https://api.vercel.com";
const ROLLBACK_WINDOW_MS = 15 * 60 * 1000;
const DISPATCH_MAX_AGE_MS = 15 * 60 * 1000;

function escapeHtml(value) {
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
  if (alertKind !== "new_server_error" && alertKind !== "server_error_spike") {
    throw new Error("PostHog alert kind is invalid");
  }
  if (typeof value.release !== "string" || !/^[0-9a-f]{40}$/i.test(value.release)) {
    throw new Error("PostHog alert release is invalid");
  }
  if (typeof value.event_id !== "string" || !/^[0-9a-f-]{32,64}$/i.test(value.event_id)) {
    throw new Error("PostHog alert event id is invalid");
  }
  if (typeof value.fingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(value.fingerprint)) {
    throw new Error("PostHog alert fingerprint is invalid");
  }
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
    release: value.release.toLowerCase(),
    fingerprint: value.fingerprint.toLowerCase(),
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

async function jsonRequest(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
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

function mcpHeaders(token, idempotencyKey) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
}

function incidentTitle(alert) {
  const prefix = alert.alert_kind === "server_error_spike" ? "[incident] Server error spike" : "[incident] New server error";
  return `${prefix}: ${alert.name}`.slice(0, 120);
}

function rollbackMessage(alert, rollback) {
  if (!rollback) {
    if (alert.alert_kind === "server_error_spike") {
      return "No rollback ran because the current deployment is older than 15 minutes.";
    }
    return "No rollback ran because this is the first occurrence.";
  }
  if (rollback.action === "not_eligible") {
    return rollback.reason;
  }
  if (rollback.action === "pending") {
    return "Automatic rollback is running because the spike followed a deployment.";
  }
  if (rollback.action === "requested") {
    return "Production now runs the previous ready release.";
  }
  if (rollback.action === "failed") {
    return `Automatic rollback failed: ${rollback.reason || "unknown failure"}.`;
  }
  return `Automatic rollback stopped without changing production: ${rollback.reason || rollback.action}.`;
}

function incidentDescription(alert, rollback) {
  const action = rollbackMessage(alert, rollback);
  return (
    `<p><strong>${escapeHtml(alert.message)}</strong></p>` +
    `<ul>` +
    `<li>Release: <code>${escapeHtml(alert.release)}</code></li>` +
    `<li>Errors in five minutes: ${alert.count}</li>` +
    `<li>${escapeHtml(action)}</li>` +
    `<li><a href="${escapeHtml(alert.issue_url)}">Open the errors in PostHog</a></li>` +
    `</ul>`
  );
}

async function createIncident(fetchImpl, mcpToken, alert, rollback, config) {
  const result = await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks/create`, {
    method: "POST",
    headers: mcpHeaders(mcpToken, `posthog-incident-${alert.event_id}`),
    body: JSON.stringify({
      project_id: config.boardId,
      section_id: config.bugsSectionId,
      title: incidentTitle(alert),
      description: incidentDescription(alert, rollback),
      content_type: "html",
    }),
  });
  const incidentNumber = result.task?.uniqueIndex;
  if (
    !Number.isSafeInteger(incidentNumber) ||
    incidentNumber < 1 ||
    incidentNumber > 999_999_999
  ) {
    throw new Error("Incident response had no valid ticket number");
  }
  return {
    number: incidentNumber,
    url: `${config.appUrl}/detail/project-${config.boardId}/${incidentNumber}`,
  };
}

async function commentOnManagerThread(fetchImpl, mcpToken, alert, incident, rollback, config) {
  const result = rollbackMessage(alert, rollback);
  const opening = alert.alert_kind === "server_error_spike"
    ? `A server error crossed ${alert.count} occurrences in five minutes.`
    : "PostHog found a new production server error.";
  const incidentText = incident
    ? `<a href="${incident.url}">Open incident HTPR-${incident.number}</a>.`
    : "The incident ticket could not be created.";
  const text =
    `<p><strong>${escapeHtml(opening)}</strong></p>` +
    `<p><span data-type="mention" class="mention" data-id="Manager" data-label="agent-${config.managerAgentId}">Manager</span> ` +
    `${incidentText} ${escapeHtml(result)} ` +
    `<a href="${escapeHtml(alert.issue_url)}">Open PostHog</a>.</p>`;
  await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/comments`, {
    method: "POST",
    headers: mcpHeaders(mcpToken, `posthog-manager-${alert.event_id}`),
    body: JSON.stringify({
      unique_index: config.managerThread,
      project_id: config.boardId,
      text,
      content_type: "html",
    }),
  });
}

async function commentOnIncident(fetchImpl, mcpToken, alert, incident, rollback, config) {
  const text = `<p><strong>${escapeHtml(rollbackMessage(alert, rollback))}</strong></p>`;
  await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/comments`, {
    method: "POST",
    headers: mcpHeaders(mcpToken, `posthog-rollback-result-${alert.event_id}`),
    body: JSON.stringify({
      unique_index: incident.number,
      project_id: config.boardId,
      text,
      content_type: "html",
    }),
  });
}

export async function handlePostHogAlert(
  rawPayload,
  {
    fetchImpl = fetch,
    rollbackImpl = emergencyRollback,
    now = Date.now(),
    vercelToken = process.env.VERCEL_TOKEN || "",
    mcpToken = process.env.HYPERTASK_MCP_TOKEN || "",
    dispatchSecret = process.env.POSTHOG_ALERT_DISPATCH_SECRET?.trim() || "",
  } = {},
) {
  if (!verifyPostHogPayloadSignature(rawPayload, dispatchSecret)) {
    throw new Error("PostHog alert payload signature is invalid");
  }
  const alert = validatePostHogPayload(rawPayload, now);
  if (alert.environment === "preview") {
    return { action: "preview_verified", release: alert.release };
  }
  if (!vercelToken || !mcpToken) throw new Error("Workflow secrets are not configured");
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
  const pending = rollbackEligible ? { action: "pending" } : initialRollback;
  const [incidentResult, rollbackResult] = await Promise.allSettled([
    createIncident(fetchImpl, mcpToken, alert, pending, config),
    rollbackEligible
      ? rollbackImpl(alert.release, vercelToken, fetchImpl)
      : Promise.resolve(initialRollback),
  ]);
  let rollback;
  if (rollbackResult.status === "fulfilled") {
    rollback = rollbackResult.value;
  } else {
    const reason =
      rollbackResult.reason instanceof Error
        ? rollbackResult.reason.message
        : "rollback failed";
    rollback = { action: "failed", reason };
  }
  const incident = incidentResult.status === "fulfilled"
    ? incidentResult.value
    : undefined;

  const comments = [
    commentOnManagerThread(fetchImpl, mcpToken, alert, incident, rollback, config),
  ];
  if (rollbackEligible && incident) {
    comments.push(commentOnIncident(fetchImpl, mcpToken, alert, incident, rollback, config));
  }
  const commentResults = await Promise.allSettled(comments);
  const commentFailure = commentResults.find(
    (result) => result.status === "rejected",
  );
  if (commentFailure?.status === "rejected") {
    throw commentFailure.reason;
  }
  if (incidentResult.status === "rejected") {
    throw incidentResult.reason;
  }
  return { action: "alerted", incident, rollback };
}

async function main() {
  const payload = JSON.parse(process.env.POSTHOG_ALERT_PAYLOAD || "null");
  const result = await handlePostHogAlert(payload);
  console.log(JSON.stringify(result));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
