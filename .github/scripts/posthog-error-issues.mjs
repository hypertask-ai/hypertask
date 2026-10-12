import { setTimeout } from "node:timers/promises";
import { createIncident, escapeHtml, incidentDescription, jsonRequest, mcpHeaders } from "./posthog-error-alert.mjs";

const POSTHOG = "https://eu.posthog.com";
const PROJECT = "236160";
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

export function issueQuery(issueId) {
  if (!UUID.test(issueId)) throw new Error("PostHog issue ID is invalid");
  return `SELECT count(), uniqExactIf(coalesce(toString(properties.userId), toString(properties.user_id), distinct_id), distinct_id != 'hypertask-app' OR properties.userId IS NOT NULL OR properties.user_id IS NOT NULL), min(timestamp), max(timestamp), argMax(properties.$exception_list, timestamp), argMax(properties.ht_source, timestamp), argMax(coalesce(properties.ht_url, properties.$current_url), timestamp), countIf(distinct_id = 'hypertask-app' AND properties.userId IS NULL AND properties.user_id IS NULL)
FROM events WHERE event = '$exception' AND toString(properties.$exception_issue_id) = '${issueId}'
AND (properties.ht_environment = 'production' OR (properties.ht_environment IS NULL AND properties.$current_url LIKE 'https://app.hypertask.ai/%'))`;
}

export async function readProductionIssue(fetchImpl, apiKey, issueId, { wait = setTimeout, alert = {} } = {}) {
  const query = issueQuery(issueId);
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const issue = await jsonRequest(fetchImpl, `${POSTHOG}/api/projects/${PROJECT}/error_tracking/issues/${issueId}/`, { headers });
  if (issue.id !== issueId) throw new Error("PostHog returned a different issue");
  // Lifecycle events can arrive before the exception is visible in ClickHouse.
  for (const delay of [0, 10_000, 20_000, 30_000, 60_000]) {
    if (delay) await wait(delay);
    const stats = await jsonRequest(fetchImpl, `${POSTHOG}/api/projects/${PROJECT}/query/`, {
      method: "POST", headers, body: JSON.stringify({ query: { kind: "HogQLQuery", query }, refresh: "force_blocking" }),
    });
    if (!Array.isArray(stats.results) || stats.results.length !== 1 || stats.hasMore || stats.error) {
      throw new Error("PostHog issue counts are missing or truncated");
    }
    const [count, users, first, last, rawExceptions, source, url, unidentifiedHits] = stats.results[0];
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(users) || users < 0 || !Number.isSafeInteger(unidentifiedHits) || unidentifiedHits < 0) {
      throw new Error("PostHog issue counts are invalid");
    }
    if (!count) continue;
    if (!Number.isFinite(Date.parse(first)) || !Number.isFinite(Date.parse(last))) throw new Error("PostHog issue timestamps are invalid");
    const exceptions = typeof rawExceptions === "string" ? JSON.parse(rawExceptions) : rawExceptions;
    const message = String(exceptions?.[0]?.value || issue.description || "Unknown production error").slice(0, 1000);
    return {
      issue_id: issueId, name: String(issue.name || "Error").slice(0, 120), message,
      count, users, unidentified_hits: unidentifiedHits, timestamp: first, last_seen: last, source, url,
      issue_url: `${POSTHOG}/project/${PROJECT}/error_tracking/${issueId}`,
      ...rateIssue(message, users, source),
    };
  }
  // Zero visible rows cannot distinguish ingestion lag from a non-production issue.
  const message = String(issue.description || alert.message || "Unknown production error").slice(0, 1000);
  const rating = rateIssue(message, null, alert.source);
  return {
    issue_id: issueId, name: String(issue.name || alert.name || "Error").slice(0, 120), message,
    count: null, users: null, unidentified_hits: null, last_seen: null,
    issue_url: `${POSTHOG}/project/${PROJECT}/error_tracking/${issueId}`,
    ...rating, severity_reason: `${rating.severity_reason} Provisional: production counts are not yet available.`,
  };
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
  const oldCount = Number(/<p(?: class="posthog-issue-end")?>posthog-count:(\d+)/.exec(existing.description)?.[1] || 0);
  const oldUsers = /(?:<p(?: class="posthog-issue-end")?>posthog-count:(?:\d+|unknown); |<p>)posthog-users:(\d+)/.exec(existing.description)?.[1];
  const previousEvent = /<p>posthog-alert:([^<]+)/.exec(existing.description)?.[1];
  const lifecycleEvent = issue.event_id && `${issue.alert_kind}:${issue.event_id}`;
  if (lifecycleEvent && previousEvent === lifecycleEvent && issue.count <= oldCount && issue.users <= (oldUsers ?? 0)) return { action: "unchanged" };
  if (!lifecycleEvent && issue.count <= oldCount && issue.users <= (oldUsers ?? 0)) return { action: "unchanged" };
  issue = { ...issue, count: issue.count == null && !oldCount ? null : Math.max(oldCount, issue.count), users: issue.users == null && oldUsers === undefined ? null : Math.max(oldUsers ?? 0, issue.users) };
  issue = { ...issue, ...rateIssue(issue.message, issue.users, issue.source) };
  // Preserve human content and assignees; a resolved issue returning reopens its ticket.
  const key = lifecycleEvent ? `posthog-alert-${issue.event_id}` : `posthog-count-${issue.issue_id}-${issue.count}-${issue.users}`;
  const note = issue.alert_kind === "issue_spiking"
    ? `PostHog detected a spike: ${issue.spike_count} hits in its detection window, baseline ${issue.spike_baseline}.`
    : issue.alert_kind === "issue_reopened" ? "PostHog reopened this issue after it was resolved." : "PostHog reported this issue.";
  const text = `<p>${escapeHtml(note)}</p><p><strong>${escapeHtml(issue.severity)}: ${issue.count ?? "unknown"} production hits, ${issue.users ?? "unknown"} known users in the issue's production history (${issue.unidentified_hits ?? "unknown"} hits without a user identity).</strong></p><p>Last seen ${escapeHtml(issue.last_seen ?? "unknown")}. <a href="${escapeHtml(issue.issue_url)}">PostHog issue</a></p>`;
  if (existing.status !== "Deleted") {
    await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/comments`, {
      method: "POST", headers: mcpHeaders(token, key), body: JSON.stringify({ task_id: existing.id, text, content_type: "html" }),
    });
  }
  let done;
  if (issue.alert_kind === "issue_reopened") {
    const projects = await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/projects?limit=100`, { headers: mcpHeaders(token) });
    const project = projects.projects?.find((item) => Number(item.id) === config.boardId);
    done = project?.sections?.find((item) => (item.section_title ?? item.title) === "Done");
  }
  const fresh = await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks?task_id=${existing.id}`, { headers: mcpHeaders(token) });
  existing = fresh.tasks?.find((task) => Number(task.id) === Number(existing.id));
  if (!existing) throw new Error("Issue ticket refresh returned no task");
  const freshCount = Number(/<p(?: class="posthog-issue-end")?>posthog-count:(\d+)/.exec(existing.description)?.[1] || 0);
  const freshUsers = /(?:<p(?: class="posthog-issue-end")?>posthog-count:(?:\d+|unknown); |<p>)posthog-users:(\d+)/.exec(existing.description)?.[1];
  issue = { ...issue, count: issue.count == null && !freshCount ? null : Math.max(freshCount, issue.count), users: issue.users == null && freshUsers === undefined ? null : Math.max(freshUsers ?? 0, issue.users) };
  issue = { ...issue, ...rateIssue(issue.message, issue.users, issue.source) };
  if (issue.count == null) issue.severity_reason += " Provisional: production counts are not yet available.";
  let description = existing.description || "";
  if (description.includes('<p class="posthog-issue-start">') && description.includes('<p class="posthog-issue-end">')) {
    description = description.replace(/<p class="posthog-issue-start">[\s\S]*?<p class="posthog-issue-end">[^<]*<\/p>/, () => incidentDescription(issue));
  } else {
    // Older tickets have no generated-section boundary. Only replace their state paragraphs.
    description = description.replace(/<p(?: class="posthog-issue-end")?>posthog-count:(?:\d+|unknown)(?:; posthog-users:(?:\d+|unknown))?<\/p>|<p>posthog-users:(?:\d+|unknown)<\/p>/g, "");
    description += `<p>posthog-count:${issue.count ?? "unknown"}; posthog-users:${issue.users ?? "unknown"}</p>`;
    if (lifecycleEvent) {
      description = description.replace(/<p>posthog-alert:[^<]*<\/p>/g, "");
      description += `<p>posthog-alert:${escapeHtml(lifecycleEvent)}</p>`;
    }
  }
  let reopen = {};
  if (issue.alert_kind === "issue_reopened" && existing.status !== "Deleted" && (existing.status === "Archive" || Number(existing.sectionId ?? existing.section_id) === Number(done?.id))) {
    reopen = { status: "Normal", sectionId: config.bugsSectionId };
  }
  const labels = (existing.labels || []).filter((label) => !["P1", "P2", "P3"].includes(label.name)).map((label) => label.id);
  await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks/update`, {
    method: "POST", headers: mcpHeaders(token, `${key}-state`),
    body: JSON.stringify({ task_id: existing.id, ...reopen, description, labels: [...labels, config.severityLabels[issue.severity]], content_type: "html" }),
  });
  return { action: "updated" };
}
