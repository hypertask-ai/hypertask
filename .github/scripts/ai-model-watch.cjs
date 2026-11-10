const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { identity } = require("../../scripts/model-diff");
const { selectWatched, worthFiling } = require("./model-watch-allowlist.cjs");

const APP = "https://app.hypertask.ai";
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const PREMIUM = `Premium models <a href="${APP}/detail/project-15/7746">wait for HTPR-7746</a>; do not auto-ship them.`;
const NOTHING_TO_UNDO = "nothing to undo; no picker change is made.";
const REVERT_PICKS = "point saved picks back at the old version.";

function opening({ wrong, course, decision, undo }) {
  return `<p><strong>What's wrong or wanted:</strong> ${wrong}</p>` +
    `<p><strong>Who it affects:</strong> everyone who picks an AI model in chat.</p>` +
    `<p><strong>Recommended course and why:</strong> ${course}</p>` +
    `<p><strong>What Valentin must decide:</strong> ${decision}</p>` +
    `<p><strong>How to undo:</strong> ${undo}</p><hr>`;
}

function parts({ problem, fix, decision, undo }) {
  return `<h2>Problem</h2>${problem}<h2>Fix</h2><p>${fix}</p>` +
    `<h2>Done when</h2><p>The pickers show it, and saved picks still work.</p><p>A live chat answers from it after release.</p>` +
    `<h2>Risk</h2><p>A new model could answer badly or cost more than planned.</p><p>Undo: ${undo}</p>` +
    `<h2>Decision</h2><p>${decision}</p>`;
}

const price = (finding) => finding.inputPerMillion == null
  ? "unknown; verify pricing before shipping"
  : `$${escapeHtml(finding.inputPerMillion)}`;
const sentence = (text) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function planFor(finding, automatic, premium) {
  if (finding.kind === "stale" && finding.current.length) return {
    course: "Replace it with the current version of its class. Why: the old one no longer answers.",
    decision: "nothing.",
    fix: "Replace the stale entry and move saved picks to its class version.",
    partsDecision: "Nothing. The replacement is already in its class.",
    undo: REVERT_PICKS,
  };
  if (finding.kind === "stale") return {
    course: "Check the direct provider before any removal. Why: one source cannot prove it was retired.",
    decision: "nothing.",
    fix: "Confirm the model is retired before removing it from a picker.",
    partsDecision: "Nothing. This is a check, not a picker change.",
    undo: NOTHING_TO_UNDO,
  };
  if (finding.inputPerMillion == null) return {
    course: "Hold it until the gateway price is verified. Why: cost decides whether it can ship.",
    decision: "nothing.",
    fix: "Wait for a verified gateway price before any picker change.",
    partsDecision: "No decision yet. The price is unverified.",
    undo: NOTHING_TO_UNDO,
  };
  if (automatic) return {
    course: "Ship it now and keep the old version as a fallback. Why: OpenAI and Anthropic classes always update.",
    decision: "nothing.",
    fix: "Replace the old version in every picker.",
    partsDecision: "Nothing. This is an automatic update.",
    undo: REVERT_PICKS,
  };
  if (premium) return {
    course: "Hold it until the premium model policy is settled. Why: it costs more than five dollars per million tokens.",
    decision: "nothing.",
    fix: "Wait for the premium model policy before any picker change.",
    partsDecision: "Valentin decides the premium policy first.",
    undo: NOTHING_TO_UNDO,
  };
  if (finding.kind === "new-version") return {
    course: "Ask Valentin first, then replace the old version. Why: a newer version changes what people can pick.",
    decision: "Should this replace the old version?",
    fix: "Replace the old version and move saved picks to the new one.",
    partsDecision: `Valentin's yes on the replacement. ${PREMIUM}`,
    undo: REVERT_PICKS,
  };
  return {
    course: "Ask Valentin first, then add it to every picker. Why: a new class changes what people can pick.",
    decision: "Should this model go into the pickers?",
    fix: "Add the model to every picker once Valentin agrees.",
    partsDecision: `Valentin's yes on the new class. ${PREMIUM}`,
    undo: "remove the model from the pickers.",
  };
}

function ticketFor(finding) {
  const model = `${finding.provider}/${identity(finding.model).name}`;
  const marker = `modelwatch${createHash("sha256").update(`${finding.kind}/${model}`).digest("hex").slice(0, 20)}`;
  const plan = planFor(finding, finding.action === "ship automatically", finding.action === "waits for HTPR-7746");
  const wrong = finding.kind === "stale" ? "One of our picker models is gone from the gateway."
    : finding.kind === "new-version" ? "A newer version of a model we offer is out."
    : "A model class we do not offer is new to the gateway.";
  return {
    marker,
    title: `AI model ${finding.kind}: ${model} [${marker}]`,
    description: opening({ wrong, course: plan.course, decision: plan.decision, undo: plan.undo }) + parts({
      problem: `<p>${sentence(escapeHtml(finding.reason))}. Class: <code>${escapeHtml(finding.modelClass)}</code>. Current: ${escapeHtml(finding.current.join(", ") || "none")}.</p>` +
        `<p>Gateway input price per million tokens: ${price(finding)}.</p><p>${sentence(escapeHtml(finding.action))}.</p>`,
      fix: plan.fix,
      decision: plan.partsDecision,
      undo: plan.undo,
    }),
  };
}

function rollupTicket(findings, now = new Date()) {
  const models = findings.map((finding) => `${finding.provider}/${identity(finding.model).name}`).sort();
  const families = [...new Set(models.map((model) => identity(model).family))].sort();
  const fingerprint = createHash("sha256").update(models.join("\n")).digest().readBigUInt64BE(0).toString().slice(0, 9);
  const marker = `modelwatchrollup-${families.slice(0, 3).join("-")}-${models.length}-${fingerprint}`;
  const items = findings.map((finding) => `<li><code>${escapeHtml(`${finding.provider}/${identity(finding.model).name}`)}</code>. Gateway input price per million tokens: ${price(finding)}. ${escapeHtml(finding.action)}.</li>`).join("");
  return {
    marker,
    title: `AI model watch new classes [${marker}]`,
    description: opening({
      wrong: `${findings.length} new model classes are not in our catalog.`,
      course: "Add the classes Valentin approves to every picker. Why: they are new frontier releases.",
      decision: "Should these new classes go into the pickers?",
      undo: "remove the new classes from the pickers.",
    }) + parts({
      problem: `<p>Gateway check ${now.toISOString().slice(0, 10)}. The same list does not file again.</p><ul>${items}</ul>`,
      fix: "Add these classes to every picker once Valentin agrees. Move saved picks to the new version. Check the gateway input and output prices first.",
      undo: "remove the new classes from the pickers.",
      decision: `New classes and providers need Valentin's yes. ${PREMIUM}`,
    }),
  };
}

function fileReport(report, options = {}) {
  if (!report.sourcesUsed?.length || !Array.isArray(report.findings)) throw new Error("No usable model discovery report");
  const { kept, skipped } = selectWatched(report.findings);
  console.log(`model-watch: ${report.findings.length} finding(s), ${kept.length} watched, ${skipped.length} outside the watch list`);
  for (const finding of skipped) console.log(`model-watch not watched: ${finding.kind}: ${finding.model}`);
  if (!worthFiling(kept)) {
    console.log("model-watch: nothing watched is ready to file; no ticket filed");
    return Promise.resolve([]);
  }
  return fileFindings({ ...report, findings: kept }, options);
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

module.exports = { ticketFor, rollupTicket, fileFindings, fileReport };
if (require.main === module) {
  fileReport(JSON.parse(fs.readFileSync(process.argv[2], "utf8")))
    .then((results) => console.log(JSON.stringify(results, null, 2)))
    .catch((error) => { console.error(`AI model ticket filing failed: ${error.message}`); process.exitCode = 1; });
}
