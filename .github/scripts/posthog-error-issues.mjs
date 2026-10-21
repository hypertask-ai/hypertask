import { setTimeout } from "node:timers/promises";
import { createIncident, escapeHtml, jsonRequest, mcpHeaders } from "./posthog-error-alert.mjs";

const POSTHOG = "https://eu.posthog.com";
const PROJECT = "236160";
// Tests that throw an error on purpose put this marker in its message (YPER4-384).
export const FORCED_TEST = /\[ht-forced-test\]/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function rateIssue(message, users, source) {
  if (/^PostHog pipeline canary yper4-331-/.test(message)) {
    return { severity: "P3", severity_reason: "A deliberate monitoring test, not a user failure." };
  }
  if (/included AI allowance|monthly AI allowance|AI allowance.*(?:used|exceeded)|dedicated team AI Gateway key|direct BYOK key is required/i.test(message)) {
    return { severity: "P3", severity_reason: "An expected plan limit or missing AI key, not a crash.", user_impact: "AI cannot continue until the team adds a key or renews its allowance." };
  }
  if (/^(?:Invalid input|Validation error|Project not found or access denied)$/.test(message)) {
    return { severity: "P3", severity_reason: "A rejected user request, not a production outage.", user_impact: "The request is refused and the user sees a validation or access message." };
  }
  if (users >= 10 || /data loss|lost data|out of memory|fatal|\bcrash(?:ed)?\b|AI usage persistence failed|Uncaught (?:Error|TypeError)|Minified React error/i.test(message) || source === "client") {
    return {
      severity: "P1",
      severity_reason: users >= 10 ? "At least ten known users are affected." : "A crash or failed durable accounting needs urgent investigation.",
      ...(/AI usage persistence failed/i.test(message) ? { user_impact: "AI may finish answering, but its usage is not saved, so usage totals and allowance accounting may be wrong." } : source === "client" ? { user_impact: "The page stops working or shows an error fallback instead of the requested content." } : {}),
    };
  }
  return {
    severity: "P2", severity_reason: "A feature failed for some users; no confirmed crash or data loss.",
    ...(/No output generated/i.test(message) ? { user_impact: "The requested AI reply or draft is empty." } : /prisma\.team\.findUnique/i.test(message) ? { user_impact: "A page that needs team details fails to load or shows an error." } : {}),
  };
}

export function issueQuery(issueId, productionOnly = true) {
  if (!UUID.test(issueId)) throw new Error("PostHog issue ID is invalid");
  return `SELECT count(), uniqExactIf(coalesce(toString(properties.userId), toString(properties.user_id), distinct_id), distinct_id != 'hypertask-app' OR properties.userId IS NOT NULL OR properties.user_id IS NOT NULL), min(timestamp), max(timestamp), argMax(properties.$exception_list, timestamp), argMax(properties.ht_source, timestamp), argMax(coalesce(properties.ht_url, properties.$current_url), timestamp), countIf(distinct_id = 'hypertask-app' AND properties.userId IS NULL AND properties.user_id IS NULL)
FROM events WHERE event = '$exception' AND toString(properties.$exception_issue_id) = '${issueId}'
${productionOnly ? "AND (properties.ht_environment = 'production' OR (properties.ht_environment IS NULL AND properties.$current_url LIKE 'https://app.hypertask.ai/%'))" : ""}`;
}

export async function readProductionIssue(fetchImpl, apiKey, issueId, { wait = setTimeout } = {}) {
  const query = issueQuery(issueId);
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const issue = await jsonRequest(fetchImpl, `${POSTHOG}/api/projects/${PROJECT}/error_tracking/issues/${issueId}/`, { headers });
  if (issue.id !== issueId) throw new Error("PostHog returned a different issue");
  const readStats = async (query) => {
    const stats = await jsonRequest(fetchImpl, `${POSTHOG}/api/projects/${PROJECT}/query/`, {
      method: "POST", headers, body: JSON.stringify({ query: { kind: "HogQLQuery", query }, refresh: "force_blocking" }),
    });
    if (!Array.isArray(stats.results) || stats.results.length !== 1 || stats.hasMore || stats.error) {
      throw new Error("PostHog issue counts are missing or truncated");
    }
    const [count, users, , , , , , unidentifiedHits] = stats.results[0];
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(users) || users < 0 || !Number.isSafeInteger(unidentifiedHits) || unidentifiedHits < 0) {
      throw new Error("PostHog issue counts are invalid");
    }
    return stats.results[0];
  };
  // Lifecycle events can arrive before the exception is visible in ClickHouse.
  const delays = [0, 10_000, 20_000, 30_000, 60_000, 0];
  for (const [attempt, delay] of delays.entries()) {
    if (delay) await wait(delay);
    const finalRead = attempt === delays.length - 1;
    if (finalRead && !(await readStats(issueQuery(issueId, false)))[0]) {
      return { action: "retry", reason: "PostHog issue has no exceptions in any environment yet" };
    }
    const [count, users, first, last, rawExceptions, source, url, unidentifiedHits] = await readStats(query);
    if (!count) {
      if (finalRead) return { action: "skip", reason: "PostHog issue has only non-production exceptions" };
      continue;
    }
    if (!Number.isFinite(Date.parse(first)) || !Number.isFinite(Date.parse(last))) throw new Error("PostHog issue timestamps are invalid");
    const exceptions = typeof rawExceptions === "string" ? JSON.parse(rawExceptions) : rawExceptions;
    const message = String(exceptions?.[0]?.value || issue.description || "Unknown production error").slice(0, 1000);
    if (FORCED_TEST.test(`${issue.name}\n${issue.description}\n${message}`)) {
      return { action: "skip", reason: "Forced test error marked [ht-forced-test]" };
    }
    return {
      issue_id: issueId, name: String(issue.name || "Error").slice(0, 120), message,
      count, users, unidentified_hits: unidentifiedHits, timestamp: first, last_seen: last, source, url,
      issue_url: `${POSTHOG}/project/${PROJECT}/error_tracking/${issueId}`,
      ...rateIssue(message, users, source),
    };
  }
}

export async function findIssueTicket(fetchImpl, token, config, issueId) {
  let found;
  for (const status of ["Normal", "Archive", "Deleted"]) {
    let offset = 0;
    while (true) {
      const page = await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks?project_id=${config.boardId}&status=${status}&search=${encodeURIComponent(issueId)}&limit=100&offset=${offset}`, {
        headers: mcpHeaders(token),
      });
      if (!Array.isArray(page.tasks)) throw new Error("Issue ticket search returned no task list");
      for (const task of page.tasks) {
        if (task.description?.includes(`PostHog issue ID: <code>${issueId}</code>`) && (!found || Number(task.id) < Number(found.id))) found = task;
      }
      if (page.tasks.length < 100) break;
      offset += 100;
      if (offset >= 10000) throw new Error("Issue ticket search is truncated");
    }
  }
  return found;
}

export async function severityLabels(fetchImpl, token, config) {
  const endpoint = `${config.appUrl}/api/mcp/projects/${config.boardId}/labels`;
  const page = await jsonRequest(fetchImpl, endpoint, { headers: mcpHeaders(token) });
  if (!Array.isArray(page.labels)) throw new Error("Severity label lookup failed");
  const labels = {};
  for (const name of ["P1", "P2", "P3"]) {
    let label = page.labels.find((item) => item.name === name);
    if (!label) {
      const created = await jsonRequest(fetchImpl, endpoint, { method: "POST", headers: mcpHeaders(token), body: JSON.stringify({ name }) });
      label = created.label;
    }
    if (!label?.id) throw new Error(`Severity label ${name} is unavailable`);
    labels[name] = label.id;
  }
  return labels;
}

export async function upsertIssue(fetchImpl, token, config, issue) {
  let existing = await findIssueTicket(fetchImpl, token, config, issue.issue_id);
  if (!existing) {
    existing = await findIssueTicket(fetchImpl, token, config, issue.issue_id);
    if (!existing) {
      const incident = await createIncident(fetchImpl, token, issue, config);
      // Different lifecycle payloads have different API idempotency hashes.
      const canonical = await findIssueTicket(fetchImpl, token, config, issue.issue_id);
      if (!canonical) throw new Error("Created issue ticket is not visible");
      if (Number(canonical.id) !== Number(incident.id)) {
        await upsertIssue(fetchImpl, token, config, issue);
        await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks/update`, {
          method: "POST", headers: mcpHeaders(token, `posthog-duplicate-${incident.id}`),
          body: JSON.stringify({ task_id: incident.id, status: "Archive" }),
        });
        return { action: "updated" };
      }
      return { action: "created", incident };
    }
  }
  const fresh = await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks?task_id=${existing.id}`, { headers: mcpHeaders(token) });
  existing = fresh.tasks?.find((task) => Number(task.id) === Number(existing.id));
  if (!existing) throw new Error("Issue ticket refresh returned no task");
  if (existing.status === "Deleted") return { action: "skip", reason: "PostHog issue ticket was deleted" };
  issue = { ...issue, ...rateIssue(issue.message, issue.users, issue.source) };
  const key = `posthog-alert-${process.env.GITHUB_RUN_ID || "local"}-${issue.event_id || `${issue.issue_id}-${issue.count}-${issue.users}`}`;
  const oldLabels = (existing.labels || []).filter((label) => ["P1", "P2", "P3"].includes(label.name));
  const severityChanged = oldLabels.length !== 1 || oldLabels[0].id !== config.severityLabels[issue.severity];
  let reopen = {};
  if (issue.alert_kind === "issue_reopened") {
    const projects = await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/projects?limit=100`, { headers: mcpHeaders(token) });
    const project = projects.projects?.find((item) => Number(item.id) === config.boardId);
    const done = project?.sections?.find((item) => (item.section_title ?? item.title) === "Done");
    if (existing.status === "Archive" || Number(existing.sectionId ?? existing.section_id) === Number(done?.id)) {
      reopen = { status: "Normal", sectionId: config.bugsSectionId };
    }
  }
  if (severityChanged || reopen.status) {
    await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks/update`, {
      method: "POST", headers: mcpHeaders(token, `${key}-state`),
      body: JSON.stringify({
        task_id: existing.id, ...reopen,
        ...(severityChanged ? {
          remove_labels: oldLabels.filter((label) => label.id !== config.severityLabels[issue.severity]).map((label) => label.id),
          add_labels: [config.severityLabels[issue.severity]],
        } : {}),
      }),
    });
  }
  const note = issue.alert_kind === "issue_spiking"
    ? `PostHog detected a spike: ${issue.spike_count} hits in its detection window, baseline ${issue.spike_baseline}.`
    : issue.alert_kind === "issue_reopened" ? "PostHog reopened this issue after it was resolved." : "PostHog reported this issue again.";
  const severityNote = severityChanged ? `<p>Severity changed from ${escapeHtml(oldLabels.map((label) => label.name).join(" + ") || "unrated")} to ${escapeHtml(issue.severity)}. ${escapeHtml(issue.severity_reason)}</p>` : "";
  const text = `<p><strong>${escapeHtml(note)}</strong></p><p>${escapeHtml(issue.severity)}: ${issue.count} production hits, ${issue.users} known users in the issue's production history (${issue.unidentified_hits} hits without a user identity).</p>${severityNote}<p>Last seen ${escapeHtml(issue.last_seen)}. <a href="${escapeHtml(issue.issue_url)}">PostHog issue</a></p><p>Next: Investigate the latest production errors in PostHog and record findings here.</p>`;
  await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/comments`, {
    method: "POST", headers: mcpHeaders(token, key), body: JSON.stringify({ task_id: existing.id, text, content_type: "html" }),
  });
  return { action: "updated" };
}
