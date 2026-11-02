const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { identity } = require("../../scripts/model-diff");

const APP = "https://app.hypertask.ai";
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function priceText(inputPerMillion) {
  return inputPerMillion === null || inputPerMillion === undefined ? "not published yet" : `$${escapeHtml(inputPerMillion)}`;
}

function ticketFor(finding) {
  const model = `${finding.provider}/${identity(finding.model).name}`;
  const marker = `modelwatch${createHash("sha256").update(`${finding.kind}/${model}`).digest("hex").slice(0, 20)}`;
  return {
    marker,
    title: `AI model ${finding.kind}: ${model} [${marker}]`,
    description: `<p><strong>${escapeHtml(finding.action)}.</strong></p><p>${escapeHtml(finding.reason)}.</p><p>Class: ${escapeHtml(finding.modelClass)}. Current: ${escapeHtml(finding.current.join(", ") || "none")}.</p><p>Input price per million tokens: ${priceText(finding.inputPerMillion)}.</p>${finding.inputPerMillion === null || finding.inputPerMillion === undefined ? "<p>Check the price before shipping.</p>" : ""}<p>The update skill has the steps.</p>`,
  };
}

function rollupTicket(findings, now = new Date()) {
  const marker = `modelwatchrollup-${now.toISOString().slice(0, 10)}`;
  const items = findings.map((finding) => `<li><code>${escapeHtml(`${finding.provider}/${identity(finding.model).name}`)}</code>. Input price per million tokens: ${priceText(finding.inputPerMillion)}. ${escapeHtml(finding.action)}.</li>`).join("");
  return {
    marker,
    title: `AI model watch new classes [${marker}]`,
    description: `<p><strong>${findings.length} new model classes are not in our catalog.</strong></p><ul>${items}</ul><p>The update skill has the steps.</p><p>New classes need Valentin's yes.</p><p>Premium models <a href="${APP}/detail/project-15/7746">wait for HTPR-7746</a>.</p>`,
  };
}

async function fileFindings(report, { fetchImpl = fetch, token = process.env.HYPERTASK_MCP_TOKEN, now = new Date() } = {}) {
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
  async function ticketExists(ticket) {
    let cursor;
    let total;
    let searched = 0;
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
        return true;
      }
      cursor = search.nextCursor;
      if (cursor ? !search.tasks.length || cursors.has(cursor) : searched !== total) {
        throw new Error("Ticket search is incomplete; refusing duplicate creation");
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return false;
  }
  const newClasses = report.findings.filter((finding) => finding.kind === "new-class");
  const tickets = report.findings.filter((finding) => finding.kind !== "new-class").map(ticketFor);
  if (newClasses.length) tickets.unshift(rollupTicket(newClasses, now));
  const results = [];
  for (const ticket of tickets) {
    if (await ticketExists(ticket)) {
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

module.exports = { ticketFor, rollupTicket, fileFindings };
if (require.main === module) {
  fileFindings(JSON.parse(fs.readFileSync(process.argv[2], "utf8")))
    .then((results) => console.log(JSON.stringify(results, null, 2)))
    .catch((error) => { console.error(`AI model ticket filing failed: ${error.message}`); process.exitCode = 1; });
}
