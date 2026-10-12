import { pathToFileURL } from "node:url";
import { createIncident, escapeHtml, jsonRequest, mcpHeaders, productionConfig } from "./posthog-error-alert.mjs";

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

export function issueQuery(since) {
  const parsed = Date.parse(since);
  if (typeof since !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(since) || !Number.isFinite(parsed)) {
    throw new Error("POSTHOG_ISSUES_SINCE must be an ISO timestamp");
  }
  const date = new Date(parsed).toISOString();
  return `SELECT toString(properties.$exception_issue_id), count(), uniqExactIf(coalesce(toString(properties.userId), toString(properties.user_id), distinct_id), distinct_id != 'hypertask-app' OR properties.userId IS NOT NULL OR properties.user_id IS NOT NULL), min(timestamp), max(timestamp), argMax(properties.$exception_list, timestamp), argMax(properties.ht_source, timestamp), argMax(coalesce(properties.ht_url, properties.$current_url), timestamp), countIf(distinct_id = 'hypertask-app' AND properties.userId IS NULL AND properties.user_id IS NULL)
FROM events WHERE event = '$exception' AND timestamp >= toDateTime('${date}')
AND (properties.ht_environment = 'production' OR (properties.ht_environment IS NULL AND properties.$current_url LIKE 'https://app.hypertask.ai/%'))
AND properties.$exception_issue_id IS NOT NULL
GROUP BY properties.$exception_issue_id LIMIT 10000`;
}

export async function readProductionIssues(fetchImpl, apiKey, since) {
  const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  const endpoint = `${POSTHOG}/api/projects/${PROJECT}/error_tracking/issues/`;
  let next = `${endpoint}?limit=100`;
  const issues = new Map();
  const visited = new Set();
  while (next) {
    const pageUrl = new URL(next, endpoint);
    if (pageUrl.origin !== POSTHOG || pageUrl.pathname !== new URL(endpoint).pathname || visited.has(pageUrl.href) || visited.size >= 1000) {
      throw new Error("PostHog issue pagination is invalid");
    }
    visited.add(pageUrl.href);
    const page = await jsonRequest(fetchImpl, pageUrl.href, { headers });
    if (!Array.isArray(page.results)) throw new Error("PostHog returned no issue list");
    for (const issue of page.results) {
      if (UUID.test(issue.id) && Date.parse(issue.first_seen) >= Date.parse(since)) issues.set(issue.id, issue);
    }
    next = page.next;
  }
  const stats = await jsonRequest(fetchImpl, `${POSTHOG}/api/projects/${PROJECT}/query/`, {
    method: "POST", headers, body: JSON.stringify({ query: { kind: "HogQLQuery", query: issueQuery(since) }, refresh: "force_blocking" }),
  });
  if (!Array.isArray(stats.results) || stats.results.length >= 10000 || stats.hasMore === true || stats.error) {
    throw new Error("PostHog issue counts are missing or truncated");
  }
  return stats.results.flatMap((row) => {
    const [id, count, users, first, last, rawExceptions, source, url, unidentifiedHits] = row;
    const issue = issues.get(id);
    if (!issue) return [];
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(users) || users < 0 || !Number.isSafeInteger(unidentifiedHits) || unidentifiedHits < 0 || !Number.isFinite(Date.parse(last))) {
      throw new Error("PostHog issue counts are invalid");
    }
    const exceptions = typeof rawExceptions === "string" ? JSON.parse(rawExceptions) : rawExceptions;
    const message = String(exceptions?.[0]?.value || issue.description || "Unknown production error").slice(0, 1000);
    return [{
      issue_id: id, name: String(issue.name || "Error").slice(0, 120), message,
      count, users, unidentified_hits: unidentifiedHits, timestamp: first, last_seen: last, source, url,
      issue_url: `${POSTHOG}/project/${PROJECT}/error_tracking/${id}`,
      ...rateIssue(message, users, source),
    }];
  });
}

export async function findIssueTicket(fetchImpl, token, config, issueId) {
  for (const status of ["Normal", "Archive", "Deleted"]) {
    let offset = 0;
    while (true) {
      const page = await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks?project_id=${config.boardId}&status=${status}&search=${encodeURIComponent(issueId)}&limit=100&offset=${offset}`, {
        headers: mcpHeaders(token),
      });
      if (!Array.isArray(page.tasks)) throw new Error("Issue ticket search returned no task list");
      const found = page.tasks.find((task) => task.description?.includes(`PostHog issue ID: <code>${issueId}</code>`));
      if (found) return found;
      if (page.tasks.length < 100) break;
      offset += 100;
      if (offset >= 10000) throw new Error("Issue ticket search is truncated");
    }
  }
  return undefined;
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
  const existing = await findIssueTicket(fetchImpl, token, config, issue.issue_id);
  if (!existing) return { action: "created", incident: await createIncident(fetchImpl, token, issue, config) };
  const oldCount = Number(/posthog-count:(\d+)/.exec(existing.description)?.[1] || 0);
  const oldUsers = Number(/posthog-users:(\d+)/.exec(existing.description)?.[1] || 0);
  if (issue.count <= oldCount && issue.users <= oldUsers) return { action: "unchanged" };
  // Comments preserve human edits, assignees, and the ticket's workflow state.
  const key = `posthog-count-${issue.issue_id}-${issue.count}-${issue.users}`;
  const text = `<p><strong>${escapeHtml(issue.severity)}: ${issue.count} production hits, ${issue.users} known users since monitoring began (${issue.unidentified_hits} hits without a user identity).</strong></p><p>Last seen ${escapeHtml(issue.last_seen)}. <a href="${escapeHtml(issue.issue_url)}">PostHog issue</a></p>`;
  if (existing.status !== "Deleted") {
    await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/comments`, {
      method: "POST", headers: mcpHeaders(token, key), body: JSON.stringify({ task_id: existing.id, text, content_type: "html" }),
    });
  }
  let description = existing.description
    .replace(/posthog-count:\d+/, `posthog-count:${issue.count}`)
    .replace(/posthog-users:\d+/, `posthog-users:${issue.users}`);
  if (!/posthog-count:\d+/.test(description)) description += `<p>posthog-count:${issue.count}</p>`;
  if (!/posthog-users:\d+/.test(description)) description += `<p>posthog-users:${issue.users}</p>`;
  const labels = (existing.labels || []).filter((label) => !["P1", "P2", "P3"].includes(label.name)).map((label) => label.id);
  await jsonRequest(fetchImpl, `${config.appUrl}/api/mcp/tasks/update`, {
    method: "POST", headers: mcpHeaders(token, `${key}-state`),
    body: JSON.stringify({ task_id: existing.id, description, labels: [...labels, config.severityLabels[issue.severity]], content_type: "html" }),
  });
  return { action: "updated" };
}

export async function pollIssues({ fetchImpl = fetch, apiKey = process.env.POSTHOG_FULL_API_KEY, token = process.env.HYPERTASK_MCP_TOKEN, since = process.env.POSTHOG_ISSUES_SINCE, config = productionConfig() } = {}) {
  if (!apiKey || !token || !since) throw new Error("PostHog issue poll credentials or activation timestamp are missing");
  if (Date.parse(since) > Date.now()) throw new Error("PostHog issue activation timestamp is in the future");
  issueQuery(since);
  const issues = await readProductionIssues(fetchImpl, apiKey, since);
  if (!issues.length) return { issues: 0 };
  config = { ...config, severityLabels: await severityLabels(fetchImpl, token, config) };
  const outcomes = [];
  // Continue after an individual failure, but fail the job so the watchdog notices.
  let failures = 0;
  for (const issue of issues) {
    try { outcomes.push(await upsertIssue(fetchImpl, token, config, issue)); }
    catch (error) {
      failures++;
      const cause = error instanceof Error ? /HTTP [0-9]{3}|no valid ticket number/.exec(error.message)?.[0] : undefined;
      console.error(`::error::PostHog issue ${issue.issue_id} could not be filed: ${cause || "ticket API or contract failure"}`);
    }
  }
  if (failures) throw new Error(`${failures} PostHog issue ticket writes failed`);
  return { issues: issues.length, created: outcomes.filter((item) => item.action === "created").length, updated: outcomes.filter((item) => item.action === "updated").length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  pollIssues().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(`::error::PostHog issue poll failed: ${error instanceof Error ? error.message.replace(/[\r\n]/g, " ") : "request failure"}`);
    process.exitCode = 1;
  });
}
