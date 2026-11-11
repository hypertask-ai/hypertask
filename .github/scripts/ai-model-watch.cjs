const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { identity } = require("../../scripts/model-diff");
const { selectWatched, worthFiling } = require("./model-watch-allowlist.cjs");

const APP = "https://app.hypertask.ai";
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const priceLine = (finding) => `Price per million input tokens: ${finding.inputPerMillion == null ? "unknown; check before shipping" : `$${escapeHtml(finding.inputPerMillion)}`}.`;

const actionSentences = (finding) => String(finding.action ?? "")
  .split(/;\s*/)
  .map((part) => part.trim().replace(/[.\s]+$/, ""))
  .filter(Boolean)
  .map((part) => `${part}.`)
  .join(" ");

const decisionFor = (finding) => {
  if (finding.kind === "stale") return "Nothing; a runner removes the stale entry.";
  if (finding.inputPerMillion != null && finding.inputPerMillion > 5) return "Nothing yet; HTPR-7746 must ship first.";
  if (finding.inputPerMillion == null) return "Nothing until the gateway price is checked.";
  if (["openai", "anthropic"].includes(finding.provider)) return "Nothing; a runner ships it.";
  return "Valentin says yes or no before this ships.";
};

async function refusalDetail(response) {
  if (typeof response.text !== "function") return "";
  const body = await response.text().catch(() => "");
  if (!body) return "";
  let message = body;
  try {
    const parsed = JSON.parse(body);
    message = parsed.message || parsed.error || body;
  } catch {
    message = body;
  }
  const flat = String(message).replace(/\s+/g, " ").trim();
  return flat ? `: ${flat.slice(0, 300)}` : "";
}

const plainBlock = ({ wanted, affects, course, decide, undo }) => [
  `<p><strong>What's wrong or wanted:</strong> ${wanted}</p>`,
  `<p><strong>Who it affects:</strong> ${affects}</p>`,
  `<p><strong>Recommended course and why:</strong> ${course}</p>`,
  `<p><strong>What Valentin must decide:</strong> ${decide}</p>`,
  `<p><strong>How to undo:</strong> ${undo}</p>`,
].join("");

const plainParts = ({ problem, fix, done, risk, decision }) => [
  `<p>Problem</p>`,
  problem,
  `<p>Fix</p>`,
  fix,
  `<p>Done when</p>`,
  done,
  `<p>Risk</p>`,
  risk,
  `<p>Decision</p>`,
  decision,
].join("");

function ticketFor(finding) {
  const model = `${finding.provider}/${identity(finding.model).name}`;
  const marker = `modelwatch${createHash("sha256").update(`${finding.kind}/${model}`).digest("hex").slice(0, 20)}`;
  const entry = escapeHtml((finding.current ?? []).slice(0, 3).join(", ") || "none");
  const decision = decisionFor(finding);
  const decide = decision.startsWith("Valentin") ? "yes or no before this model ships." : "nothing";
  const plain = plainBlock({
    wanted: "A watched model differs from our catalog or the gateway list.",
    affects: "people who pick a model in chat.",
    course: `change the catalog entry. Why: the pickers should offer the models we watch.`,
    decide,
    undo: "revert the catalog change and the saved pick migration.",
  });
  const parts = plainParts({
    problem: `<p>Model ${escapeHtml(model)}, class ${escapeHtml(finding.modelClass ?? "unknown")}.</p><p>Reason: ${escapeHtml(finding.reason ?? "not stated")}.</p><p>Catalog now: ${entry}.</p><p>${priceLine(finding)}</p>`,
    fix: `<p>${escapeHtml(actionSentences(finding))}</p><p>Follow the update-ai-models skill. Replace the old model in every picker.</p><p>Migrate saved picks and check gateway input and output prices.</p>`,
    done: `<p>A live chat answer uses the new model.</p>`,
    risk: `<p>Saved picks can break. Undo by reverting the catalog change.</p>`,
    decision: `<p>${decision}</p>`,
  });
  return {
    marker,
    title: `AI model ${finding.kind}: ${model} [${marker}]`,
    description: `${plain}<hr>${parts}`,
  };
}

function rollupTicket(findings, now = new Date()) {
  const models = findings.map((finding) => `${finding.provider}/${identity(finding.model).name}`).sort();
  const families = [...new Set(models.map((model) => identity(model).family))].sort();
  const fingerprint = createHash("sha256").update(models.join("\n")).digest().readBigUInt64BE(0).toString().slice(0, 9);
  const marker = `modelwatchrollup-${families.slice(0, 3).join("-")}-${models.length}-${fingerprint}`;
  const items = findings.map((finding) => `<li>${escapeHtml(`${finding.provider}/${identity(finding.model).name}`)}. ${priceLine(finding)} ${escapeHtml(finding.action)}.</li>`).join("");
  const gated = findings.filter((finding) => finding.inputPerMillion == null || finding.inputPerMillion > 5);
  const decision = gated.length
    ? `Nothing yet; ${gated.length} of these wait for the price check or HTPR-7746.`
    : "Valentin says yes or no to these classes.";
  const plain = plainBlock({
    wanted: "New model classes are on the gateway and not in our catalog.",
    affects: "people who pick a model in chat.",
    course: "add the classes below to the catalog. Why: people cannot pick a model we do not list.",
    decide: gated.length ? "nothing" : "yes or no to these model classes.",
    undo: "revert the catalog change and the saved pick migration.",
  });
  const parts = plainParts({
    problem: `<p>New classes on the gateway: ${findings.length}. None are in our catalog.</p><p>Gateway check ${now.toISOString().slice(0, 10)}. The same list does not file again.</p>`,
    fix: `<ul>${items}</ul>`,
    done: `<p>Every model below shows in each picker. A live chat answer uses one.</p>`,
    risk: `<p>A wrong saved pick is the worst case. Undo by reverting the change.</p>`,
    decision: `<p>${decision}</p>`,
  });
  return {
    marker,
    title: `AI model watch new classes [${marker}]`,
    description: `${plain}<hr>${parts}`,
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
    if (!response.ok) throw new Error(`Hypertask ticket API returned HTTP ${response.status}${await refusalDetail(response)}`);
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
