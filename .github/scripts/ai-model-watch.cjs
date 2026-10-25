const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { identity } = require("../../scripts/model-diff");

const APP = "https://app.hypertask.ai";
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function ticketFor(finding) {
  const model = `${finding.provider}/${identity(finding.model).name}`;
  const marker = `modelwatch${createHash("sha256").update(`${finding.kind}/${model}`).digest("hex").slice(0, 20)}`;
  return {
    marker,
    title: `AI model ${finding.kind}: ${model} [${marker}]`,
    description: `<p><strong>${escapeHtml(finding.action)}.</strong></p><p>${escapeHtml(finding.reason)}. Class: <code>${escapeHtml(finding.modelClass)}</code>. Current: ${escapeHtml(finding.current.join(", ") || "none")}.</p><p>Gateway input price per million tokens: ${finding.inputPerMillion === null ? "unknown; verify pricing before shipping" : `$${escapeHtml(finding.inputPerMillion)}`}.</p><p>Follow <code>.claude/skills/update-ai-models/SKILL.md</code>: replace the old version in every picker, migrate saved picks, verify gateway input/output prices and get a live chat answer after release. New classes/providers need Valentin's yes. Premium models <a href="${APP}/detail/project-15/7746">wait for HTPR-7746</a>; do not auto-ship them.</p>`,
  };
}

async function fileFindings(report, { fetchImpl = fetch, token = process.env.HYPERTASK_MCP_TOKEN } = {}) {
  if (!token) throw new Error("HYPERTASK_MCP_TOKEN is missing");
  if (!report.sourcesUsed?.length || !Array.isArray(report.findings)) throw new Error("No usable model discovery report");
  console.log(`model-diff sources: ${report.sourcesUsed.join(", ")}`);
  async function api(route, body, idempotencyKey) {
    const response = await fetchImpl(`${APP}/api/mcp/tasks/${route}`, {
      method: body ? "POST" : "GET", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Hypertask ticket API returned HTTP ${response.status}`);
    const result = await response.json();
    if (result.success !== true) throw new Error("Hypertask ticket API rejected the operation");
    return result;
  }
  const results = [];
  for (const finding of report.findings) {
    const ticket = ticketFor(finding);
    let cursor;
    let total;
    let searched = 0;
    let exists = false;
    const cursors = new Set();
    do {
      const search = await api(`search?project_id=15&status=open&limit=50&q=${encodeURIComponent(ticket.marker)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!Array.isArray(search.tasks) || search.partial || !Number.isInteger(search.total) || search.total < 0 ||
        (total !== undefined && search.total !== total) ||
        (search.nextCursor != null && (typeof search.nextCursor !== "string" || !search.nextCursor.trim()))) {
        throw new Error("Ticket search is incomplete; refusing duplicate creation");
      }
      total = search.total;
      searched += search.tasks.length;
      if (searched > total) throw new Error("Ticket search is incomplete; refusing duplicate creation");
      if (search.tasks.some((task) => task.title === ticket.title)) {
        exists = true;
        break;
      }
      cursor = search.nextCursor;
      if (cursor ? !search.tasks.length || cursors.has(cursor) : searched !== total) {
        throw new Error("Ticket search is incomplete; refusing duplicate creation");
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if (exists) {
      results.push({ title: ticket.title, action: "exists" });
      continue;
    }
    const result = await api("create", { project_id: 15, section_id: 4389, title: ticket.title,
      description: ticket.description, content_type: "html" }, ticket.marker);
    if (!result.task?.ticketNumber) throw new Error("Created ticket has no ticket number; search before retrying");
    results.push({ title: ticket.title, action: "created", ticket: result.task.ticketNumber });
  }
  return results;
}

module.exports = { ticketFor, fileFindings };
if (require.main === module) {
  fileFindings(JSON.parse(fs.readFileSync(process.argv[2], "utf8")))
    .then((results) => console.log(JSON.stringify(results, null, 2)))
    .catch((error) => { console.error(`AI model ticket filing failed: ${error.message}`); process.exitCode = 1; });
}
