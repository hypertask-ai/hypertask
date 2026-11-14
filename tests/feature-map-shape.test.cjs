const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const featureMapDir = process.env.FEATURE_MAP_DIR || path.join(__dirname, "..", ".claude", "skills", "verify-qa", "reference", "feature-map");
const pages = fs.readdirSync(featureMapDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "INDEX.md")
  .map((entry) => entry.name)
  .sort();
const requiredHeadings = [
  "Sub-features",
  "How to get to it (user POV)",
  "Driving it with agent-browser",
  "Gotchas",
];
const template = `template: ${requiredHeadings.map((heading) => `## ${heading}`).join(" | ")}`;

function levelTwoHeadings(markdown) {
  const headings = [];
  let fence = null;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
      continue;
    }
    if (marker && (marker[1][0] !== "`" || !marker[2].includes("`"))) {
      fence = marker[1];
      continue;
    }
    const heading = line.match(/^## (.+)$/);
    if (heading) headings.push(heading[1]);
  }
  return headings;
}

test("every feature-map page has the four pstack level-two headings in order", () => {
  for (const page of pages) {
    const headings = levelTwoHeadings(fs.readFileSync(path.join(featureMapDir, page), "utf8"));
    assert.deepEqual(headings, requiredHeadings, `${page}: ${headings.join(" | ")}\n${template}`);
  }
});

test("the feature-map folder contains at least one page", () => {
  assert.ok(pages.length > 0, `No feature-map pages found in ${featureMapDir}`);
});

test("INDEX.md links every feature-map page and has no dead markdown links", () => {
  const index = fs.readFileSync(path.join(featureMapDir, "INDEX.md"), "utf8");
  const links = [...index.matchAll(/\[[^\]]*\]\(<?([^\s)>]+\.md)(?:#[^\s)>]*)?>?(?:\s+"[^"]*")?\)/g)]
    .map((match) => match[1]);
  const failures = [];
  for (const page of pages) {
    if (!links.some((link) => link === page || link.endsWith(`/${page}`))) {
      failures.push(`INDEX.md: missing link to ${page}`);
    }
  }
  for (const link of links) {
    if (!fs.existsSync(path.join(featureMapDir, link))) {
      failures.push(`INDEX.md: dead link "${link}"`);
    }
  }
  assert.equal(failures.length, 0, failures.join("\n"));
});
