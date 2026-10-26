import { setTimeout } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const APP = "https://app.hypertask.ai";
export const FAILURE_TITLE = "[INFRA] PostHog error-to-ticket monitoring failed";

// Independent of the PostHog receiver, credentials, queries and incident parser.
async function api(fetchImpl, token, path, body, key) {
  const response = await fetchImpl(`${APP}/api/mcp${path}`, {
    method: body ? "POST" : "GET", signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Hypertask monitoring API returned HTTP ${response.status}`);
  const result = await response.json();
  if (result.success === false) throw new Error("Hypertask monitoring API rejected the operation");
  return result;
}

export async function reportFailure({ fetchImpl = fetch, token = process.env.HYPERTASK_MCP_TOKEN, runUrl, workflow, runId }) {
  if (!token || !/^https:\/\/github.com\/hypertask-ai\/hypertask\/actions\/runs\/\d+$/.test(runUrl) || !/^\d+$/.test(String(runId))) {
    throw new Error("Failure reporter credentials or run identity are invalid");
  }
  let existing;
  for (const status of ["Normal", "Archive", "Deleted"]) {
    const page = await api(fetchImpl, token, `/tasks?project_id=4060&status=${status}&search=${encodeURIComponent(FAILURE_TITLE)}&limit=100`);
    if (!Array.isArray(page.tasks)) throw new Error("Failure ticket lookup returned no tasks");
    existing = page.tasks.find((task) => task.title === FAILURE_TITLE);
    if (existing) break;
  }
  const text = `<p><strong>The PostHog error-to-ticket safety net failed.</strong> New production errors may not reach the Bugs board. Check the workflow log and restore the pipeline.</p><p><a href="${runUrl}">Failed workflow run ${runId}</a></p>`;
  if (existing) {
    const projects = await api(fetchImpl, token, "/projects?limit=100");
    const sections = projects.projects?.find((item) => Number(item.id) === 4060)?.sections;
    const done = sections?.find((item) => (item.section_title ?? item.title) === "Done");
    if (existing.status === "Archive" || existing.status === "Deleted" || Number(existing.sectionId ?? existing.section_id) === Number(done?.id)) {
      const active = sections?.find((item) => (item.section_title ?? item.title) === "Backlog") || sections?.find((item) => (item.section_title ?? item.title) !== "Done");
      if (!active?.id) throw new Error("Board 4060 active section is unavailable");
      await api(fetchImpl, token, "/tasks/update", { task_id: existing.id, status: "Normal", sectionId: Number(active.id) });
    }
    await api(fetchImpl, token, "/comments", { task_id: existing.id, text, content_type: "html" }, `posthog-monitor-failure-${runId}`);
  } else {
    await api(fetchImpl, token, "/tasks/create", { project_id: 4060, title: FAILURE_TITLE, description: text, content_type: "html" }, "posthog-monitor-failure-ticket");
  }
  console.log(`PostHog failure recorded for run ${runId}`);
  return { action: existing ? "updated" : "created", workflow };
}

export async function runCanary({ fetchImpl = fetch, token = process.env.HYPERTASK_MCP_TOKEN, testToken = process.env.POSTHOG_ERROR_TEST_TOKEN, apiKey = process.env.POSTHOG_FULL_API_KEY, runId = process.env.GITHUB_RUN_ID, attempt = process.env.GITHUB_RUN_ATTEMPT || "1", now = Date.now, wait = setTimeout, timeoutMs = 15 * 60 * 1000 } = {}) {
  if (!token || !testToken || !apiKey || !/^\d{1,20}$/.test(String(runId)) || !/^\d{1,3}$/.test(String(attempt))) {
    throw new Error("Nightly canary credentials or run identity are missing");
  }
  const marker = `yper4-331-${runId}-${attempt}`;
  const deadline = now() + timeoutMs;
  const triggered = await fetchImpl(`${APP}/api/integrations/posthog/error-test`, {
    method: "POST", signal: AbortSignal.timeout(30_000),
    headers: { "x-error-test-token": testToken, "x-posthog-canary": marker },
  });
  if (triggered.status !== 500) throw new Error(`Production error-test returned HTTP ${triggered.status}, expected 500`);
  let fallbackIssueId;
  while (now() < deadline) {
    const page = await api(fetchImpl, token, `/tasks?project_id=15&status=Normal&search=${marker}&limit=100`);
    if (!Array.isArray(page.tasks)) throw new Error("Nightly canary lookup returned no tasks");
    // A legacy error reporter's ticket is not proof of PostHog issue ingestion.
    let ticket = page.tasks.find((task) => task.description?.includes(marker) && task.description.includes("PostHog issue ID: <code>") && /posthog-alert:issue_(?:created|reopened):/.test(task.description));
    let boardId = 15;
    let delivery = "github";
    if (!ticket) {
      if (!fallbackIssueId) {
        const found = await fetchImpl("https://eu.posthog.com/api/projects/236160/query/", {
          method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({ query: { kind: "HogQLQuery", query: `SELECT DISTINCT toString(properties.$exception_issue_id) FROM events WHERE event = '$exception' AND properties.ht_environment = 'production' AND toString(properties.$exception_list) LIKE '%${marker}%' LIMIT 2` }, refresh: "force_blocking" }),
        });
        if (!found.ok) throw new Error(`Canary PostHog lookup returned HTTP ${found.status}`);
        const result = await found.json();
        if (!Array.isArray(result.results) || result.hasMore || result.error || result.results.length > 1) throw new Error("Canary fallback issue lookup is incomplete or ambiguous");
        fallbackIssueId = result.results[0]?.[0];
        if (fallbackIssueId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fallbackIssueId)) throw new Error("Canary fallback issue ID is invalid");
      }
      if (fallbackIssueId) {
        const fallback = await api(fetchImpl, token, `/tasks?project_id=4060&status=Normal&search=${fallbackIssueId}&limit=100`);
        if (!Array.isArray(fallback.tasks)) throw new Error("Canary fallback lookup returned no tasks");
        const receipt = new RegExp(`<p>posthog-dispatch-fallback:issue:${fallbackIssueId}:[0-9a-f-]{36}<\\/p>`);
        ticket = fallback.tasks.find((task) => receipt.test(task.description ?? ""));
        boardId = 4060;
        delivery = "fallback";
      }
    }
    if (ticket) {
      const issueId = delivery === "fallback" ? fallbackIssueId : /PostHog issue ID: <code>([0-9a-f-]{36})<\/code>/.exec(ticket.description)?.[1];
      if (!issueId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(issueId)) throw new Error("Canary ticket has no valid PostHog issue ID");
      const issueUrl = `https://eu.posthog.com/api/projects/236160/error_tracking/issues/${issueId}/`;
      const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
      const found = await fetchImpl(issueUrl, { headers, signal: AbortSignal.timeout(30_000) });
      if (!found.ok) throw new Error(`Canary PostHog lookup returned HTTP ${found.status}`);
      const issue = await found.json();
      if (issue.id !== issueId || !issue.description?.includes(marker)) throw new Error("PostHog issue does not match the nightly canary");
      if (now() >= deadline) throw new Error("Canary alert ticket arrived after fifteen minutes");
      const projects = await api(fetchImpl, token, "/projects?limit=100");
      const project = projects.projects?.find((item) => Number(item.id) === boardId);
      const done = project?.sections?.find((item) => (item.section_title ?? item.title) === "Done");
      if (!done?.id) throw new Error(`Board ${boardId} Done section is unavailable`);
      await api(fetchImpl, token, "/tasks/update", { task_id: ticket.id, sectionId: Number(done.id) }, `posthog-canary-close-${marker}`);
      const resolved = await fetchImpl(issueUrl, {
        method: "PATCH", headers, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ status: "resolved" }),
      });
      if (!resolved.ok || (await resolved.json()).status !== "resolved") throw new Error("Canary PostHog issue resolution failed");
      console.log(`Nightly PostHog canary passed and closed its ticket (${delivery}): ${marker}`);
      return { action: "verified", ticketId: ticket.id, marker, boardId, delivery };
    }
    await wait(Math.min(30_000, Math.max(0, deadline - now())));
  }
  throw new Error(`No matching board 15 PostHog ticket within 15 minutes: ${marker}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = process.env.POSTHOG_FAILED_RUN ? JSON.parse(process.env.POSTHOG_FAILED_RUN) : null;
  const work = event ? reportFailure({ runId: event.id, runUrl: event.html_url, workflow: event.name }) : runCanary();
  work.catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : "PostHog monitoring failed"}`);
    process.exitCode = 1;
  });
}
