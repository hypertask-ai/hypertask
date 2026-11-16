#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const policyPath = ".github/agent-rule-checks.json";

export function unenforcedRows(markdown, marker) {
  return markdown.split(/\r?\n/).filter((line) => line.startsWith("|") && line.includes(marker));
}

export function enforcedChecks(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  const checks = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      if (match[1].includes("/")) checks.push(match[1]);
    }
  }
  return checks;
}

export function audit({ markdown, policy, exists }) {
  const problems = [];
  if (!policy || typeof policy.unenforcedMarker !== "string" || !Number.isInteger(policy.unenforcedCeiling)) {
    return ["agent rule check policy is incomplete"];
  }
  if (!Array.isArray(policy.checks) || !Array.isArray(policy.retiredInMap) || typeof policy.enforcedHeading !== "string") {
    return ["agent rule check policy is incomplete"];
  }
  const rows = unenforcedRows(markdown, policy.unenforcedMarker);
  if (rows.length !== policy.unenforcedCeiling) {
    problems.push(
      rows.length > policy.unenforcedCeiling
        ? `Unenforced agent rules grew from ${policy.unenforcedCeiling} to ${rows.length}. Add a check, delete the rule text, then set the ceiling to the new count.`
        : `Unenforced agent rules fell from ${policy.unenforcedCeiling} to ${rows.length}. Set the ceiling to ${rows.length} in the same change.`,
    );
  }
  for (const phrase of policy.retiredInMap) {
    if (markdown.includes(phrase)) problems.push(`Retired rule text is back: ${phrase}`);
  }
  const listed = enforcedChecks(markdown, policy.enforcedHeading);
  if (policy.checks.length === 0) problems.push("The check list is empty.");
  for (const check of policy.checks) {
    if (!listed.includes(check)) problems.push(`Enforced table is missing ${check}`);
    if (!exists(check)) problems.push(`Check file is missing: ${check}`);
  }
  return problems;
}

export function auditRepo(root) {
  const policy = JSON.parse(readFileSync(join(root, policyPath), "utf8"));
  const markdown = readFileSync(join(root, policy.map), "utf8");
  return audit({
    markdown,
    policy,
    exists: (file) => existsSync(join(root, file)),
  });
}

function main() {
  const problems = auditRepo(process.cwd());
  if (problems.length === 0) {
    console.log("agent rule map: ok");
    return;
  }
  console.error(["agent rule map: FAILED", ...problems].join("\n"));
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
