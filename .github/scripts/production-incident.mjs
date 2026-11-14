import { createHash } from "node:crypto";

// Files, or adds a note to, the emergency ticket on the Hypertask board when
// production-alert.mjs reports a live failure or a rollback (YPER4-1375).
// The ticket carries the incident label, so the fleet takes it before all other work.
const API = "https://app.hypertask.ai/api/mcp";
const BOARD = 15;
const BUGS_SECTION = 4389;
const LABELS = ["incident", "brain-hard"];

const WHAT = {
  "health-failure": "Live health checks failed",
  "smoke-failure": "Live smoke test failed",
  "api-reachability": "Live API is unreachable",
  rollback: "Automatic rollback ran",
};

const ROLLBACK_NOTE = {
  "health-failure": "A guarded rollback was requested.",
  "smoke-failure": "No rollback yet. It waits for a second smoke failure.",
  "api-reachability": "No rollback was requested.",
};

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function incidentWhat(kind, cause, message = "") {
  if (kind === "rollback" && /Production rollback:\s*failed\b/i.test(message)) return "Automatic rollback failed";
  return WHAT[cause] ?? "Live production check failed";
}

export function incidentTitle(kind, cause, message) {
  return `[INCIDENT] ${incidentWhat(kind, cause, message)} on app.hypertask.ai`;
}

function rollbackNote(kind, cause, message) {
  if (kind !== "rollback") return ROLLBACK_NOTE[cause] ?? "Rollback status is in the agent log.";
  const action = /Production rollback:\s*(\w+)/i.exec(message)?.[1]?.toLowerCase();
  if (action === "requested") return "A rollback was requested.";
  if (action === "failed") return "The rollback failed. A person must act now.";
  return "Rollback status is in the agent log.";
}

// Sentences stay short and free of code names so the agent writing rules accept them.
export function incidentDescription({ kind, cause, message = "", runUrl = "", now = new Date() }) {
  const when = now.toISOString().slice(0, 16).replace("T", " ");
  const link = runUrl ? `<p>Open <a href="${escapeHtml(runUrl)}">the failing run</a> for details.</p>` : "";
  return (
    `<h2>Problem</h2><p>${escapeHtml(incidentWhat(kind, cause, message))} on app.hypertask.ai.</p>` +
    `<p>It was seen at ${when} UTC.</p><p>${rollbackNote(kind, cause, message)}</p>${link}` +
    `<h2>Fix</h2><p>Find the cause. Bring the live app back first.</p>` +
    `<h2>Done when</h2><p>The live checks pass again on app.hypertask.ai.</p>` +
    `<h2>Risk</h2><p>Customers may see errors until this is fixed.</p>` +
    `<h2>Decision</h2><p>None.</p>`
  );
}

export async function fileIncident(config, fetchImpl = fetch) {
  const { kind, cause, message = "", mcpToken, runUrl = "" } = config;
  if (!["live", "rollback"].includes(kind) || !/^[a-z0-9-]+$/.test(cause)) throw new Error("Invalid incident classification");
  if (!mcpToken) return "skipped";
  const now = config.now ?? new Date();
  const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 24);
  const api = async (route, options = {}, key = "") => {
    const method = options.method || "GET";
    const safeRoute = route.split("?")[0].replace(/\/runs\/[^/]+/, "/runs/:id").replace(/\/tasks\/\d+/, "/tasks/:id");
    let result;
    try {
      result = await fetchImpl(`${API}${route}`, {
        ...options,
        headers: { Authorization: `Bearer ${mcpToken}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
      });
    } catch {
      throw new Error(`Incident ${method} ${safeRoute} failed (network error)`);
    }
    if (!result.ok) {
      let code;
      try { code = (await result.json()).code; } catch {}
      const reason = ["invalid_field", "forbidden", "not_found", "unauthorized", "agent_writing"].includes(code) ? `, ${code}` : "";
      throw new Error(`Incident ${method} ${safeRoute} failed (HTTP ${result.status}${reason})`);
    }
    try { return await result.json(); }
    catch { throw new Error(`Incident ${method} ${safeRoute} returned invalid JSON`); }
  };

  const page = await api(`/projects/${BOARD}/labels`);
  if (!Array.isArray(page.labels)) throw new Error("Incident board labels are unavailable");
  const ids = [];
  for (const name of LABELS) {
    let label = page.labels.find((item) => item.name === name);
    if (!label) label = (await api(`/projects/${BOARD}/labels`, { method: "POST", body: JSON.stringify({ name }) })).label;
    if (!label?.id) throw new Error(`Incident label ${name} is unavailable`);
    ids.push(label.id);
  }

  const title = incidentTitle(kind, cause, message);
  const search = await api(`/tasks?project_id=${BOARD}&status=Normal&labels=${encodeURIComponent(ids[0])}&limit=100`);
  if (!Array.isArray(search.tasks)) throw new Error("Incident ticket search returned no task list");
  const open = search.tasks.filter((task) => task.sectionIsDone !== true);
  const marker = `prod-incident-${hash(`${kind}:${cause}`)}-${hash(runUrl || now.toISOString())}`;
  let ticket = open.find((task) => task.title === title) ?? open[0];
  let outcome = "added";
  if (!ticket) {
    const created = await api("/tasks/create", {
      method: "POST",
      body: JSON.stringify({
        project_id: BOARD, section_id: BUGS_SECTION, title, priority: "urgent", labels: ids, content_type: "html",
        description: incidentDescription({ kind, cause, message, runUrl, now }),
      }),
    }, marker);
    ticket = created.task;
    outcome = "created";
  }
  if (!Number.isSafeInteger(ticket?.id) || ticket.id < 1) throw new Error("Incident ticket returned no task id");

  // The agent lane holds the raw alert text; one note per failing run keeps retries from repeating it.
  const log = await api(`/tasks/${ticket.id}/agent-activity?limit=100`);
  if (!Array.isArray(log.activities)) throw new Error("Incident activity search returned no list");
  if (log.activities.some((activity) => activity.text?.includes(marker))) return outcome;
  const opened = await api("/agents/runs", { method: "POST", body: JSON.stringify({ taskId: ticket.id, source: "runtime" }) });
  if (typeof opened.run?.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(opened.run.id)) throw new Error("Incident activity returned no run id");
  await api(`/agents/runs/${opened.run.id}/activities`, {
    method: "POST", body: JSON.stringify({ type: "thought", text: `${marker}\n${title}\n${message}\n${runUrl}` }),
  }, `${marker}-note`);
  return outcome;
}
