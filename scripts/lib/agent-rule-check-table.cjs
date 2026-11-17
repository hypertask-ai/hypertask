const fs = require("node:fs");
const { join } = require("node:path");

const NOTHING_YET = "nothing yet";
const RULES_HEADING = "## Always";
const TABLE_FILE = ".claude/reference/rule-checks.md";
const REPO_ROOT = join(__dirname, "..", "..");

function sectionLines(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{2,3} /.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

function alwaysRules(markdown) {
  const lines = sectionLines(markdown, RULES_HEADING);
  if (!lines) return [];
  return lines
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function ruleChecks(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|"))
    .map(cells)
    .filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)))
    .filter((row) => row[0] !== "Rule")
    .map((row) => ({ rule: row[0], check: row[1] ?? "" }));
}

function checkPaths(check) {
  return [...check.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function problems(rulesMarkdown, tableMarkdown, exists = (path) => fs.existsSync(join(REPO_ROOT, path))) {
  const found = [];
  const rules = alwaysRules(rulesMarkdown);
  if (rules.length === 0) found.push(`AGENTS.md has no "${RULES_HEADING}" list.`);
  if (!rulesMarkdown.includes(TABLE_FILE)) found.push(`AGENTS.md does not link ${TABLE_FILE}.`);

  const rows = ruleChecks(tableMarkdown);
  if (rows.length === 0) found.push(`${TABLE_FILE} has no rule table.`);

  const checks = new Map();
  for (const row of rows) {
    if (!row.rule) {
      found.push("A rule table row has no rule.");
      continue;
    }
    if (checks.has(row.rule)) found.push(`Rule listed twice in the table: ${row.rule}`);
    checks.set(row.rule, row.check);
  }

  for (const rule of rules) {
    if (!checks.has(rule)) found.push(`Rule has no table row: ${rule}`);
  }
  for (const rule of checks.keys()) {
    if (!rules.includes(rule)) found.push(`Table row names no Always rule: ${rule}`);
  }

  for (const [rule, check] of checks) {
    if (check === NOTHING_YET) continue;
    const paths = checkPaths(check);
    if (paths.length === 0) {
      found.push(`Rule row names no check file and does not say "${NOTHING_YET}": ${rule}`);
      continue;
    }
    for (const path of paths) {
      if (!exists(path)) found.push(`Rule row names a check file that does not exist (${path}): ${rule}`);
    }
  }
  return found;
}

module.exports = { alwaysRules, ruleChecks, checkPaths, problems, NOTHING_YET, RULES_HEADING, TABLE_FILE };
