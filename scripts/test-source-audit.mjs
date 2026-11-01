#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { SOURCE_PATH_PATTERN, detectSourceTextRegex, discoverTestFiles } = require("./lib/source-text-regex-detector.cjs");

const REPORT_PATH = "docs/source-text-audit/report.md";
const INVENTORY_PATH = "docs/source-text-audit/inventory.json";
const DURATIONS_PATH = "docs/source-text-audit/ci-durations.json";
const ALLOWLIST_PATH = "tests/source-text-regex-allowlist.json";
const AUDIT_TEST_PATH = "tests/test-source-audit.test.cjs";

const TICKET_PATTERN = /\b(?:HTPR|HYFA|YPER4|HYCI|IGSH|HEFE|MARK)-\d+\b/;
const ACCESS_PATTERN = /security|access|\bauth\b|permission|refus|denied|forbidden|invite|revok|still allowed/i;
const TEST_HEAD_PATTERN =
  /^[ \t]*(?:test|it)(?:\.(?:only|skip|todo|concurrent))*\s*\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/gm;
const LITERAL_PATTERN = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g;
const POLICY_PATH_PATTERN =
  /^(?:\.github\/|eslint-local-rules\/|scripts\/|config\/|tsconfig|package\.json|\.oxlintrc|docker-compose|playwright\.config|vercel\.json)/;
const MODULE_PATTERN = /(?:from\s*|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g;

export const RULES = {
  ticket: "keep:ticket",
  access: "keep:access",
  policy: "keep:policy",
  mixed: "rewrite:mixed",
  covered: "delete:covered",
  soleGuard: "rewrite:sole-guard",
};

export const REASONS = {
  [RULES.ticket]: "past-fix guard: a test title names a ticket",
  [RULES.access]: "access or security guard",
  [RULES.policy]: "guards repo policy, which no behaviour test can reach",
  [RULES.mixed]: "behaviour assertions already live in this file",
  [RULES.covered]: "text-only guard and a behaviour test imports every file it reads",
  [RULES.soleGuard]: "text-only guard and at least one file it reads has no behaviour test",
};

export function thousands(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function seconds(milliseconds) {
  return (milliseconds / 1000).toFixed(1);
}

export function splitTestBlocks(source) {
  const heads = [...source.matchAll(TEST_HEAD_PATTERN)];
  if (heads.length === 0) return [{ title: "", start: 0, text: source }];
  return heads.map((head, index) => ({
    title: head[1] ?? head[2] ?? head[3] ?? "",
    start: head.index,
    text: source.slice(head.index, heads[index + 1]?.index ?? source.length),
  }));
}

export function sourceTargets(text) {
  const targets = new Set();
  for (const literal of text.matchAll(LITERAL_PATTERN)) {
    const prefix = text.slice(Math.max(0, literal.index - 12), literal.index);
    if (/(?:require\s*\(|from\s+|import\s*\()\s*$/.test(prefix)) continue;
    const value = literal[0].slice(1, -1);
    if (/["'`\s()*]/.test(value)) continue;
    if (!SOURCE_PATH_PATTERN.test(value)) continue;
    targets.add(value.replace(/^(?:\.\.?\/)+/, "").trim());
  }
  return [...targets].sort();
}

export function moduleKey(specifier, file) {
  const aliased = specifier.startsWith("@/") ? join("src", specifier.slice(2)) : specifier;
  const resolved = aliased.startsWith(".") ? join(dirname(file), aliased) : aliased.startsWith("src/") ? aliased : null;
  if (resolved === null) return null;
  return resolved.replace(/^(?:\.\.?\/)+/, "").replace(/\.[cm]?[jt]sx?$/, "").replace(/\/+$/, "");
}

export function importedModules(source, file) {
  const keys = new Set();
  for (const specifier of source.matchAll(MODULE_PATTERN)) {
    const key = moduleKey(specifier[1], file);
    if (key !== null) keys.add(key);
  }
  return [...keys];
}

export function classifyTestSource(file, source) {
  const blocks = splitTestBlocks(source);
  const preamble = source.slice(0, blocks[0].start);
  const classified = blocks.map((block) => ({
    title: block.title,
    text: block.text,
    sourceText: detectSourceTextRegex(preamble + block.text).offender,
  }));
  if (detectSourceTextRegex(source).offender && !classified.some((block) => block.sourceText)) {
    classified[0].sourceText = true;
  }
  const sourceBlocks = classified.filter((block) => block.sourceText);
  const behaviourTests = classified.length - sourceBlocks.length;
  const guarded = sourceTargets(preamble + sourceBlocks.map((block) => block.text).join("\n"));
  const targets = guarded.length > 0 ? guarded : sourceTargets(source);
  return {
    imports: importedModules(source, file),
    file,
    class: sourceBlocks.length === 0 ? "behaviour" : behaviourTests === 0 ? "source-text" : "mixed",
    sourceTests: sourceBlocks.length,
    behaviourTests,
    targets,
    titles: sourceBlocks.map((block) => block.title),
  };
}

export function importIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    if (row.class !== "behaviour") continue;
    for (const key of row.imports) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(row.file);
    }
  }
  return index;
}

export function coveringTests(row, index) {
  return [...new Set(row.targets.flatMap((target) => importingTests(target, row.file, index)))].sort();
}

function importingTests(target, self, index) {
  const key = target.replace(/\.[cm]?[jt]sx?$/, "");
  const found = [];
  for (const candidate of [key, `${key}/index`]) {
    for (const file of index.get(candidate) ?? []) if (file !== self) found.push(file);
  }
  return found;
}

export function uncoveredTargets(row, index) {
  return row.targets.filter((target) => importingTests(target, row.file, index).length === 0);
}

export function decideRow(row, coverage, uncovered = []) {
  const titles = [row.file, ...row.titles].join("\n");
  const ticket = titles.match(TICKET_PATTERN);
  if (ticket) return { decision: "keep", rule: RULES.ticket, evidence: ticket[0] };
  const access = titles.match(ACCESS_PATTERN);
  if (access) return { decision: "keep", rule: RULES.access, evidence: `"${access[0]}"` };
  if (row.targets.length > 0 && row.targets.every((target) => POLICY_PATH_PATTERN.test(target))) {
    return { decision: "keep", rule: RULES.policy, evidence: row.targets[0] };
  }
  if (row.class === "mixed") {
    return { decision: "rewrite", rule: RULES.mixed, evidence: `${row.behaviourTests} behaviour test${row.behaviourTests === 1 ? "" : "s"} in this file` };
  }
  if (coverage.length > 0 && uncovered.length === 0) return { decision: "delete", rule: RULES.covered, evidence: coverage[0] };
  if (uncovered.length > 0) return { decision: "rewrite", rule: RULES.soleGuard, evidence: `no behaviour test imports ${uncovered[0]}` };
  return { decision: "rewrite", rule: RULES.soleGuard, evidence: "reads no file, so no behaviour test can replace it" };
}

export function testFiles(root) {
  return discoverTestFiles(root)
    .map((file) => relative(root, file).split(sep).join("/"))
    .sort();
}

export function buildInventory(root) {
  const discovered = testFiles(root);
  const allowed = new Set(JSON.parse(readFileSync(join(root, ALLOWLIST_PATH), "utf8")).allowlist);
  const classified = discovered.map((file) =>
    classifyTestSource(file, readFileSync(join(root, file), "utf8")),
  );
  const index = importIndex(classified);
  const rows = classified
    .filter((row) => row.class !== "behaviour")
    .sort((a, b) => (a.file < b.file ? -1 : 1))
    .map((row) => {
      const coverage = coveringTests(row, index);
      const call = decideRow(row, coverage, uncoveredTargets(row, index));
      return {
        file: row.file,
        class: row.class,
        allowlisted: allowed.has(row.file),
        sourceTests: row.sourceTests,
        behaviourTests: row.behaviourTests,
        targets: row.targets,
        coverage,
        decision: call.decision,
        rule: call.rule,
        reason: REASONS[call.rule],
        evidence: call.evidence,
      };
    });
  return {
    counts: {
      testFiles: classified.length,
      behaviour: classified.filter((row) => row.class === "behaviour").length,
      sourceText: rows.filter((row) => row.class === "source-text").length,
      mixed: rows.filter((row) => row.class === "mixed").length,
      allowlisted: allowed.size,
      unlisted: rows.filter((row) => !allowed.has(row.file)).length,
      decisions: {
        keep: rows.filter((row) => row.decision === "keep").length,
        rewrite: rows.filter((row) => row.decision === "rewrite").length,
        delete: rows.filter((row) => row.decision === "delete").length,
      },
    },
    cost: costOf(JSON.parse(readFileSync(join(root, DURATIONS_PATH), "utf8")), classified),
    rows,
  };
}

export function costOf(durations, classified) {
  const measured = new Map(durations.files);
  const classes = ["behaviour", "source-text", "mixed"];
  const perClass = {};
  let measuredTotal = 0;
  for (const file of classified) {
    const value = measured.get(file.file);
    if (value === undefined) continue;
    measuredTotal += value;
  }
  for (const name of classes) {
    const files = classified.filter((row) => row.class === name);
    const timed = files.filter((row) => measured.has(row.file));
    const milliseconds = timed.reduce((total, row) => total + measured.get(row.file), 0);
    perClass[name] = {
      files: files.length,
      timed: timed.length,
      untimed: files.length - timed.length,
      seconds: Number(seconds(milliseconds)),
      share: measuredTotal === 0 ? 0 : Number(((100 * milliseconds) / measuredTotal).toFixed(1)),
    };
  }
  return {
    run: durations.provenance.runId,
    sha: durations.provenance.sha,
    measuredSeconds: Number(seconds(measuredTotal)),
    untimedFiles: classified.length - classified.filter((row) => measured.has(row.file)).length,
    classes: perClass,
  };
}

export function renderReport(inventory) {
  const { counts, cost } = inventory;
  const lines = [];
  const row = (...cells) => `| ${cells.join(" | ")} |`;
  lines.push("# Source-text test audit", "");
  lines.push("Generated by `node scripts/test-source-audit.mjs`. Never edit by hand: rerun the script.", "");
  lines.push("## What this covers", "");
  lines.push(
    `All ${thousands(counts.testFiles)} test files under \`tests/\` are classified as behaviour, source-text or mixed. ` +
      "A source-text test reads a source file as text and asserts on the text, so it can only fail when that text is edited, never when the behaviour it stands for breaks.",
    "",
  );
  lines.push(
    `The lint grandfathers ${counts.allowlisted} files in \`tests/source-text-regex-allowlist.json\`; that allowlist is the cleanup surface. ` +
      `${counts.unlisted} more files read source as text without matching the lint's narrower regex test, and are listed here too.`,
    "",
  );
  lines.push("## Headline", "", `- ${thousands(counts.testFiles)} test files: ${thousands(counts.behaviour)} behaviour, ${counts.sourceText} source-text only, ${counts.mixed} mixed.`);
  lines.push(
    `- ${counts.allowlisted} allowlisted source-text files: ${counts.decisions.delete} delete, ${counts.decisions.rewrite} rewrite, ${counts.decisions.keep} keep.`,
  );
  const carrying = Number((cost.classes["source-text"].seconds + cost.classes.mixed.seconds).toFixed(1));
  lines.push(
    `- Measured cost: ${thousands(carrying)} s, or ${((100 * carrying) / cost.measuredSeconds).toFixed(1)}% of the ${thousands(cost.measuredSeconds)} s measured across all ${thousands(counts.testFiles)} files.`,
    "",
  );
  lines.push("## Decision ladder", "");
  lines.push("First matching rule wins. Every row names the rule that decided it.", "");
  lines.push(row("Order", "Rule", "Call", "Why"), row("---", "---", "---", "---"));
  const ladder = [
    ["1", RULES.ticket, "keep", "A test title names a past ticket, so it guards a fix that came back."],
    ["2", RULES.access, "keep", "The file or a test title names access, security or a refusal."],
    ["3", RULES.policy, "keep", "It only reads workflow, lint or config files, and no behaviour test can reach repo policy."],
    ["4", RULES.mixed, "rewrite", "Behaviour assertions already live here; drop the text assertions and keep the rest."],
    ["5", RULES.covered, "delete", "Only text assertions, and a behaviour test imports every file the assertions read."],
    ["6", RULES.soleGuard, "rewrite", "Only text assertions and at least one file they read has no behaviour test, so the guard must be ported, not dropped."],
  ];
  for (const entry of ladder) lines.push(row(...entry));
  lines.push("");
  lines.push("## Decisions", "", row("Decision", "Files"), row("---", "---"));
  for (const name of ["delete", "rewrite", "keep"]) lines.push(row(name, thousands(counts.decisions[name])));
  lines.push("");
  lines.push("## How to use a call", "");
  lines.push("| Call | Do |");
  lines.push("| --- | --- |");
  lines.push("| delete | Read the named behaviour test. Removes the same guarantee? Remove the file and its allowlist entry in the same batch PR. Every file the assertions read is imported by some behaviour test, which is still not proof that the exact assertion is redundant. |");
  lines.push("| rewrite | Remove the source-text assertions and keep the behaviour tests. Port an assertion into a behaviour test only when it guards something the file does not already check. |");
  lines.push("| keep | Leave it. The evidence column names the guard, so a later pass can challenge one row at a time. |");
  lines.push("");
  lines.push("## Cost per class", "");
  lines.push(`Measured from ci-tests run ${cost.run} at \`${cost.sha}\`, one production push, per-file child-process wall time.`, "");
  lines.push(row("Class", "Files", "Measured", "Not measured", "Seconds", "Share"), row("---", "---", "---", "---", "---", "---"));
  for (const name of ["behaviour", "source-text", "mixed"]) {
    const entry = cost.classes[name];
    const share = entry.share === 0 && entry.seconds > 0 ? "<0.1%" : `${entry.share}%`;
    lines.push(row(name, thousands(entry.files), thousands(entry.timed), thousands(entry.untimed), thousands(entry.seconds), share));
  }
  lines.push("");
  lines.push(
    `Seconds are the sum of per-file child-process wall time, so they overlap across shard workers and are not wall-clock savings. ` +
      `${thousands(cost.untimedFiles)} files ran inside a shared lane that reports only a batch total and are counted but not timed.`,
    "",
  );
  lines.push("## Rows", "");
  lines.push(
    row("Test file", "Class", "Source tests", "Behaviour tests", "Guards", "Decision", "Evidence"),
    row("---", "---", "---", "---", "---", "---", "---"),
  );
  for (const entry of inventory.rows) {
    const guards = entry.targets.length === 0 ? "none" : entry.targets.slice(0, 2).join(", ") + (entry.targets.length > 2 ? ", ..." : "");
    lines.push(
      row(
        `\`${entry.file}\``,
        entry.class,
        entry.sourceTests,
        entry.behaviourTests,
        guards,
        `${entry.decision} (${entry.rule})`,
        entry.evidence,
      ),
    );
  }
  lines.push("");
  lines.push("## What this report does not measure", "");
  lines.push("- Whether a source-text test ever caught a real regression. They fail on text edits, so the suite cannot say.");
  lines.push("- Whether a delete candidate's named behaviour test replaces the exact assertion. That is one read per delete row, in the batch PR.");
  lines.push("- Production failure history per file. Cleanup deletes are gated by the per-batch green ci-tests run on their own PR (HYCI-2).");
  lines.push(`- Seconds for the ${thousands(cost.untimedFiles)} files that ran inside shared lanes.`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderInventory(inventory) {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function readCommitted(root, path) {
  try {
    return readFileSync(join(root, path), "utf8");
  } catch {
    return null;
  }
}

function writeArtifacts(root, inventory) {
  mkdirSync(join(root, dirname(REPORT_PATH)), { recursive: true });
  writeFileSync(join(root, REPORT_PATH), renderReport(inventory));
  writeFileSync(join(root, INVENTORY_PATH), renderInventory(inventory));
}

function main(argv) {
  const root = process.cwd();
  const mode = argv[0] ?? "--write";

  if (mode === "--write") {
    const inventory = buildInventory(root);
    writeArtifacts(root, inventory);
    process.stdout.write(
      `wrote ${inventory.rows.length} rows: ${inventory.counts.decisions.delete} delete, ${inventory.counts.decisions.rewrite} rewrite, ${inventory.counts.decisions.keep} keep\n`,
    );
    return 0;
  }

  if (mode === "--self-test") {
    selfTest();
    process.stdout.write("classifier self-test passed\n");
    return 0;
  }

  if (mode === "--verify") {
    const failures = verify(root);
    if (failures.length > 0) {
      process.stdout.write(`${failures.join("\n")}\n`);
      return 1;
    }
    process.stdout.write("report verified\n");
    return 0;
  }

  if (mode === "--check") {
    const inventory = buildInventory(root);
    for (const [path, rendered] of [
      [REPORT_PATH, renderReport(inventory)],
      [INVENTORY_PATH, renderInventory(inventory)],
    ]) {
      if (readCommitted(root, path) !== rendered) {
        process.stdout.write(`committed ${path} differs from a fresh run\n`);
        return 1;
      }
    }
    process.stdout.write("source-text audit verified\n");
    return 0;
  }

  if (mode === "--check-cost") {
    const committed = JSON.parse(readCommitted(root, INVENTORY_PATH));
    const fresh = buildInventory(root);
    if (JSON.stringify(committed.cost) !== JSON.stringify(fresh.cost)) {
      process.stdout.write("committed cost block disagrees with a fresh run\n");
      return 1;
    }
    if (committed.counts.behaviour + committed.counts.sourceText + committed.counts.mixed !== committed.counts.testFiles) {
      process.stdout.write("class counts do not add up to the test file total\n");
      return 1;
    }
    process.stdout.write("cost reconciliation passed\n");
    return 0;
  }

  if (mode === "--check-wiring") {
    if (!testFiles(root).includes(AUDIT_TEST_PATH)) {
      process.stdout.write(`${AUDIT_TEST_PATH} is not discovered by the shared runner\n`);
      return 1;
    }
    const row = classifyTestSource(AUDIT_TEST_PATH, readFileSync(join(root, AUDIT_TEST_PATH), "utf8"));
    if (row.class !== "behaviour") {
      process.stdout.write(`${AUDIT_TEST_PATH} must stay a behaviour test, got ${row.class}\n`);
      return 1;
    }
    const allowed = JSON.parse(readFileSync(join(root, ALLOWLIST_PATH), "utf8")).allowlist;
    if (allowed.includes(AUDIT_TEST_PATH)) {
      process.stdout.write(`${AUDIT_TEST_PATH} is on the source-text allowlist\n`);
      return 1;
    }
    process.stdout.write("wiring ok\n");
    return 0;
  }

  process.stdout.write(`unknown mode ${mode}\n`);
  return 2;
}

function verify(root) {
  const inventory = buildInventory(root);
  const committed = JSON.parse(readCommitted(root, INVENTORY_PATH));
  const allowed = JSON.parse(readFileSync(join(root, ALLOWLIST_PATH), "utf8")).allowlist;
  const seen = new Set();
  const failures = [];
  for (const row of inventory.rows) {
    if (seen.has(row.file)) failures.push(`duplicate row ${row.file}`);
    seen.add(row.file);
    if (!["keep", "rewrite", "delete"].includes(row.decision)) failures.push(`bad decision on ${row.file}`);
    if (!row.reason || row.reason === "") failures.push(`missing reason on ${row.file}`);
    if (row.decision === "delete" && row.coverage.length === 0) failures.push(`delete without coverage on ${row.file}`);
  }
  for (const file of allowed) if (!seen.has(file)) failures.push(`allowlisted file has no row ${file}`);
  if (committed.rows.length !== inventory.rows.length) failures.push("committed rows do not match a fresh run");
  if (committed.counts.testFiles !== inventory.counts.testFiles) failures.push("committed total does not match a fresh run");
  for (const row of inventory.rows) if (row.class === "behaviour") failures.push(`behaviour file listed as a decision row ${row.file}`);
  return failures;
}

function selfTest() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(`self-test: ${message}`);
  };

  const behaviourFile = [
    'const test = require("node:test");',
    'const assert = require("node:assert/strict");',
    'const { add } = require("../src/arithmetic.js");',
    'test("adds", () => { assert.equal(add(1, 2), 3); });',
  ].join("\n");
  const sourceOnlyFile = [
    'const test = require("node:test");',
    'const assert = require("node:assert/strict");',
    'const { readFileSync } = require("node:fs");',
    'const { join } = require("node:path");',
    'test("route lives in the file", () => {',
    '  const source = readFileSync(join(__dirname, "../src/app/route.ts"), "utf8");',
    '  assert.match(source, /export const GET/);',
    "});",
  ].join("\n");
  const mixedFile = [sourceOnlyFile, 'test("adds", () => { assert.equal(1 + 1, 2); });'].join("\n");

  assert(classifyTestSource("tests/a.test.cjs", behaviourFile).class === "behaviour", "behaviour file class");
  const sourceOnly = classifyTestSource("tests/route-guard.test.cjs", sourceOnlyFile);
  assert(sourceOnly.class === "source-text", "source-text file class");
  assert(sourceOnly.sourceTests === 1 && sourceOnly.behaviourTests === 0, "source-text counts");
  assert(sourceOnly.targets.includes("src/app/route.ts"), "guarded target");
  const mixed = classifyTestSource("tests/route-mixed.test.cjs", mixedFile);
  assert(mixed.class === "mixed", "mixed file class");
  assert(mixed.sourceTests === 1 && mixed.behaviourTests === 1, "mixed counts");

  const blocks = splitTestBlocks(behaviourFile);
  assert(blocks.length === 1 && blocks[0].title === "adds", "block titles");

  const index = importIndex([
    { file: "tests/route.test.cjs", class: "behaviour", imports: ["src/app/route"] },
    { file: "tests/other.test.cjs", class: "source-text", imports: [] },
  ]);
  assert((index.get("src/app/route") ?? []).length === 1, "behaviour imports indexed");
  assert(moduleKey("@/lib/flags", "tests/a.test.cjs") === "src/lib/flags", "alias specifier");
  assert(moduleKey("../src/lib/flags.ts", "tests/a.test.cjs") === "src/lib/flags", "relative specifier");
  assert(moduleKey("../../../src/lib/flags", "tests/app/api/a.test.ts") === "src/lib/flags", "nested specifier");
  assert(moduleKey("node:fs", "tests/a.test.cjs") === null, "builtin specifier ignored");
  assert(importedModules('const { load } = require("../src/lib/loader.cjs");', "tests/a.test.cjs")[0] === "src/lib/loader", "import scan");

  const base = {
    file: "tests/route-guard.test.cjs",
    class: "source-text",
    sourceTests: 1,
    behaviourTests: 0,
    targets: ["src/app/route.ts"],
    titles: ["route lives in the file"],
  };
  const ticketRow = decideRow({ ...base, titles: ["route lives in the file HTPR-6138"] }, ["tests/route.test.cjs"]);
  assert(ticketRow.rule === RULES.ticket && ticketRow.decision === "keep", "ticket rule wins");
  assert(ticketRow.evidence === "HTPR-6138", "ticket evidence");
  const accessRow = decideRow({ ...base, file: "tests/security/revocation.test.cjs" }, ["tests/security.test.cjs"]);
  assert(accessRow.rule === RULES.access, "access rule");
  const mixedRow = decideRow({ ...base, class: "mixed", behaviourTests: 2 }, ["tests/route.test.cjs"]);
  assert(mixedRow.rule === RULES.mixed && mixedRow.decision === "rewrite", "mixed rule");
  const coveredRow = decideRow(base, ["tests/route.test.cjs"]);
  assert(coveredRow.rule === RULES.covered && coveredRow.decision === "delete", "covered rule");
  const soleRow = decideRow(base, []);
  assert(soleRow.rule === RULES.soleGuard && soleRow.decision === "rewrite", "sole guard rule");
  const multiTarget = { ...base, targets: ["src/app/route.ts", "src/lib/other.ts"] };
  assert(uncoveredTargets(multiTarget, index).join() === "src/lib/other.ts", "uncovered target");
  assert(uncoveredTargets(base, index).length === 0, "covered target is not uncovered");
  const partialRow = decideRow(multiTarget, ["tests/route.test.cjs"], ["src/lib/other.ts"]);
  assert(partialRow.rule === RULES.soleGuard && partialRow.decision === "rewrite", "partial coverage is not a delete");
  assert(partialRow.evidence === "no behaviour test imports src/lib/other.ts", "partial coverage names the uncovered file");
  const policyRow = decideRow({ ...base, targets: [".github/workflows/ci-tests.yml"] }, []);
  assert(policyRow.rule === RULES.policy && policyRow.decision === "keep", "policy rule");

  assert(thousands(1234567) === "1,234,567", "thousands separator");
  assert(seconds(1500) === "1.5", "seconds");

  const cost = costOf(
    { provenance: { runId: 1, sha: "abc" }, files: [["tests/a.test.cjs", 2000]] },
    [
      { file: "tests/a.test.cjs", class: "source-text" },
      { file: "tests/b.test.cjs", class: "behaviour" },
    ],
  );
  assert(cost.measuredSeconds === 2 && cost.untimedFiles === 1, "cost totals");
  assert(cost.classes["source-text"].seconds === 2 && cost.classes["source-text"].share === 100, "cost per class");
  assert(cost.classes.behaviour.timed === 0 && cost.classes.behaviour.untimed === 1, "cost coverage");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
