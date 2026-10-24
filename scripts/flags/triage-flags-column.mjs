import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const stateLabels = {
  EVERYONE: "flag:everyone",
  OWNER_ONLY: "flag:owner-only",
  OWNER_AND_QA: "flag:qa-only",
  OFF: "flag:off",
};
export const clarification = "Flags triage: Please declare the flag key and current state on this ticket.";
const labels = [...Object.values(stateLabels), "flag:internal"];
const root = fileURLToPath(new URL("../../", import.meta.url));
const flagReader = path.join(root, ".claude/skills/ship/scripts/ht-flag");

function command(binary, args) {
  const result = JSON.parse(execFileSync(binary, args, { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }));
  if (result.success === false) throw new Error(`${binary} ${args[0]} failed`);
  return result;
}

function pages(run, args, field) {
  const rows = [];
  const cursors = new Set();
  let cursor;
  do {
    const result = run("hypertask", [...args, "--limit", "100", "--json", ...(cursor ? ["--cursor", cursor] : [])]);
    if (result.success !== true || !Array.isArray(result[field])) throw new Error(`Cannot read ${field}`);
    rows.push(...result[field]);
    cursor = result.nextCursor;
    if (cursor && cursors.has(cursor)) throw new Error(`Repeated ${field} cursor`);
    if (cursor) cursors.add(cursor);
    if (!cursor && (result.has_more === true || (Number.isInteger(result.total) && rows.length !== result.total))) {
      throw new Error(`Incomplete ${field} list`);
    }
  } while (cursor);
  return rows;
}

function mentions(content, flags) {
  const tokens = new Set(content.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? []);
  return flags.filter((flag) => tokens.has(flag.key));
}

export function inspectTicket(task, flags, comments) {
  const description = task.description ?? "";
  const declared = mentions(description, flags);
  const registered = flags.filter((flag) => flag.ticketId === task.ticketNumber || flag.ticketUrl === task.url);
  let candidates = declared.length ? declared : registered;
  if (!candidates.length) candidates = mentions(comments.map((comment) => comment.text ?? comment.commentText ?? "").join("\n"), flags);
  const unknown = [...new Set(description.match(/\b(?:htpr|yper4|hyfa)-\d+-[a-z0-9]+(?:-[a-z0-9]+)*\b/g) ?? [])]
    .filter((key) => !flags.some((flag) => flag.key === key));
  const issues = [];
  const hasQuestion = comments.some((comment) => (comment.text ?? comment.commentText ?? "").includes(clarification));
  const result = { ticket: task.ticketNumber, url: task.url, issues, candidates: candidates.map((flag) => flag.key), label: null, flagUrl: null, addLink: false, ask: false };
  if (!declared.length) {
    issues.push("No declared live flag key in the description");
    result.ask = !hasQuestion;
  }
  if (unknown.length) issues.push(`Unknown or removed flag keys: ${unknown.join(", ")}`);
  if (candidates.length !== 1 || unknown.length) {
    issues.push(candidates.length > 1 ? "Multiple flag keys; declare one governing flag" : "Cannot resolve one live flag");
    result.ask = !hasQuestion;
    return result;
  }
  const flag = candidates[0];
  const label = flag.kind === "internal" ? "flag:internal" : stateLabels[flag.mode];
  if (!stateLabels[flag.mode] || !label) throw new Error(`Unknown mode for ${flag.key}: ${flag.mode}`);
  const currentLabels = (task.labels ?? []).map((entry) => entry.name).filter((name) => labels.includes(name));
  if (currentLabels.length !== 1 || currentLabels[0] !== label) issues.push(`Expected exactly one state label: ${label}`);
  const flagUrl = `https://app.hypertask.ai/admin/flags/${flag.key}`;
  const links = [...description.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const addLink = !links.includes(flagUrl) && !links.includes(`/admin/flags/${flag.key}`);
  if (addLink) issues.push(`Missing flag card link: ${flagUrl}`);
  return { ...result, label, flagUrl, addLink };
}

function readFlags(run) {
  const result = run(flagReader, ["get"]);
  if (!Array.isArray(result.flags) || result.flags.some((flag) => typeof flag.key !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(flag.key) || !stateLabels[flag.mode])) {
    throw new Error("Invalid live flag metadata");
  }
  return result.flags;
}

function readTask(run, ticket) {
  const result = run("hypertask", ["tasks", "get", ticket, "--json"]);
  if (result.success !== true || result.tasks?.length !== 1 || result.tasks[0].ticketNumber !== ticket) throw new Error(`Cannot read ${ticket}`);
  return result.tasks[0];
}

export function triageFlagsColumn({ run = command, apply = false } = {}) {
  const sections = run("hypertask", ["sections", "list", "--project", "15", "--json"]);
  if (sections.success !== true || !sections.sections?.some((section) => section.section_title === "Flags" && !section.deleted)) throw new Error("Board 15 has no Flags column");
  const flags = readFlags(run);
  const tasks = pages(run, ["tasks", "list", "--project", "15", "--section", "Flags"], "tasks");
  const report = { owner: "Mini Boss CEO", reminder: "Review this report several times daily; resolve every drift item or request the missing declaration.", clean: true, tickets: [] };
  const commentsFor = (ticket) => pages(run, ["comment", "list", ticket], "comments");
  const inspections = tasks.map((task) => ({ task, inspection: inspectTicket(task, flags, commentsFor(task.ticketNumber)) }));
  if (apply) {
    const existingLabels = pages(run, ["labels", "list", "--project", "15"], "labels");
    for (const name of labels) {
      if (!existingLabels.some((label) => label.name === name)) run("vcc", ["labels", "create", "--project", "15", "--name", name, "--json"]);
    }
  }
  for (const entry of inspections) {
    let { task, inspection } = entry;
    if (apply && inspection.issues.length) {
      task = readTask(run, task.ticketNumber);
      if (task.section !== "Flags" || task.projectId !== 15 || task.status !== "Normal") continue;
      inspection = inspectTicket(task, readFlags(run), commentsFor(task.ticketNumber));
      if (inspection.ask) run("vcc", ["comment", "add", task.ticketNumber, "--text", `<p>${clarification}</p>`, "--json"]);
      if (inspection.label) {
        const args = ["task", "update", task.ticketNumber, "--project", "15"];
        const stale = (task.labels ?? []).map((label) => label.name).filter((name) => labels.includes(name) && name !== inspection.label);
        if (stale.length) args.push("--remove-labels", stale.join(","));
        if (!(task.labels ?? []).some((label) => label.name === inspection.label)) args.push("--add-label", inspection.label);
        if (inspection.addLink) {
          const link = `<p>Flag: <a href="${inspection.flagUrl}">${inspection.candidates[0]}</a></p>`;
          const description = task.description ?? "";
          args.push("--description", /<\/body\s*>/i.test(description) ? description.replace(/<\/body\s*>/i, `${link}</body>`) : `${description}\n${link}`);
        }
        if (args.length > 6) run("vcc", [...args, "--json"]);
      }
      inspection = inspectTicket(readTask(run, task.ticketNumber), readFlags(run), commentsFor(task.ticketNumber));
    }
    if (inspection.issues.length) report.clean = false;
    report.tickets.push(inspection);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) throw new Error("Usage: node scripts/flags/triage-flags-column.mjs [--apply]");
    const report = triageFlagsColumn({ apply: args[0] === "--apply" });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.clean ? 0 : 2;
  } catch (error) {
    console.error(`Flags triage failed: ${error.message}`);
    process.exitCode = 1;
  }
}
