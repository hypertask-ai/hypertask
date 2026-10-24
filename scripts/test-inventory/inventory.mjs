import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
process.chdir(root);
const directory = "docs/test-inventory";
const evidencePath = `${directory}/evidence.json`;
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
const digest = (text) => createHash("sha256").update(text).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const walk = (node, visit) => { visit(node); ts.forEachChild(node, (child) => { walk(child, visit); }); };
const unique = (items) => [...new Set(items)].sort();
const inScope = (file) => file === "GATES.md" || file.startsWith("scripts/test-inventory/") || file.startsWith("docs/test-inventory/");
const sourceExtension = /\.(?:[cm]?[jt]sx?|ya?ml|json|sh|py|md)$/;
const ticketPattern = /\b(?:HTPR|YPER4|HYFA)[-_ ]?\d+\b/gi;
const securityPattern = /\b(?:auth(?:entication|orization|orize|orized)?|security|permission|permissions|csrf|xss|jwt|oauth|revocation|revoke|cross[- ](?:tenant|team|owner|user|board)|access|owner|member|guest|tenant|session|cookie|token|membership|unauthorized|forbidden|still[- ]allowed|signed[- ]session|board[- ]membership|invite|invitation|credential|secret|role[- ]gate)\b/i;

function analyze(file, text, repositoryFiles = null) {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  assert.equal(tree.parseDiagnostics.length, 0, `Cannot parse ${file}`);
  const nodes = [];
  walk(tree, (node) => nodes.push(node));
  const literals = nodes.filter((node) => ts.isStringLiteralLike(node)).map((node) => node.text);
  const targets = unique(literals.flatMap((value) => {
    const normalized = value.replace(/^@\//, "src/").replace(/^\.\.\//, "");
    const match = normalized.match(/(?:src|scripts|\.github|eslint-local-rules|config|e2e)\/[\w./[\]-]+/g) ?? [];
    return match.map((item) => item.replace(/[.,;:]$/, "")).flatMap((item) => {
      const options = [item, ...[".ts", ".tsx", ".js", ".cjs", ".mjs", "/index.ts", "/index.tsx"].map((suffix) => item + suffix)];
      if (repositoryFiles) return options.filter((candidate) => repositoryFiles.has(candidate));
      return sourceExtension.test(item) ? [item] : [];
    });
  }));
  const titleNodes = nodes.filter((node) => ts.isCallExpression(node) && /^(?:test|it|describe)(?:\.(?:only|skip|todo))?$/.test(node.expression.getText(tree)) && node.arguments[0] && (ts.isStringLiteralLike(node.arguments[0]) || ts.isTemplateExpression(node.arguments[0])));
  const titles = titleNodes.map((node) => ({ title: ts.isTemplateExpression(node.arguments[0]) ? node.arguments[0].getText(tree).slice(1, -1) : node.arguments[0].text, dynamic: ts.isTemplateExpression(node.arguments[0]), line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, suite: node.expression.getText(tree).startsWith("describe") }));
  const readAliases = new Set();
  for (const node of nodes) {
    if (ts.isImportSpecifier(node) && /^(?:readFileSync|readFile)$/.test(node.propertyName?.text ?? node.name.text)) readAliases.add(node.name.text);
    if (ts.isBindingElement(node) && /^(?:readFileSync|readFile)$/.test(node.propertyName?.getText(tree) ?? node.name.getText(tree))) readAliases.add(node.name.getText(tree));
  }
  const variables = new Map();
  const functions = new Map();
  const sourceNames = new Set();
  const runtimeNames = new Set();
  let hasSourceRead = false;
  const functionNodes = [];
  for (const node of nodes) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) variables.set(node.name.text, node.initializer);
      else for (const element of node.name.elements ?? []) if (element.name && ts.isIdentifier(element.name)) variables.set(element.name.text, node.initializer);
    }
    if (ts.isFunctionDeclaration(node) && node.name) functionNodes.push([node.name.text, node]);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) functionNodes.push([node.name.text, node.initializer]);
  }
  function kind(node, seen = new Set()) {
    if (!node) return "neutral";
    if (ts.isIdentifier(node)) {
      if (runtimeNames.has(node.text)) return "runtime";
      if (sourceNames.has(node.text)) return "source";
      if (seen.has(node.text)) return "neutral";
      return kind(variables.get(node.text), new Set([...seen, node.text]));
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = node.expression.getText(tree);
      const short = name.split(".").at(-1);
      if (functions.get(short) === "runtime") return "runtime";
      if (functions.get(short) === "source") return "source";
      if (/^(?:require|import|jiti|load|loadModule|loadTs|loadTS|createJiti|spawn|spawnSync|execFile|execFileSync|execSync|Function|eval)$/.test(short) || /(?:runIn(?:New|This)?Context|runInContext|compileFunction|Function|eval)$/.test(name)) return "runtime";
      if (readAliases.has(short) || /(?:readFile(?:Sync)?|readSource|read\w*Source|sourceOf|readTextFile)$/.test(short)) {
        const args = node.arguments?.map((arg) => arg.getText(tree)).join(" ") ?? "";
        if (!/\b(?:fixture|tmpdir|tempDir|temporary|outputFile|reportPath)\b/i.test(args) || /(?:src\/|\.tsx?['"]|\.cjs['"]|\.github\/)/.test(args)) {
          hasSourceRead = true;
          return "source";
        }
      }
    }
    let source = false;
    let runtime = false;
    ts.forEachChild(node, (child) => {
      const value = kind(child, seen);
      source ||= value === "source";
      runtime ||= value === "runtime";
    });
    return source ? "source" : runtime ? "runtime" : "neutral";
  }
  for (let pass = 0; pass < 8; pass++) {
    for (const [name, node] of functionNodes) {
      const body = node.body?.getText(tree) ?? "";
      if (/(?:vm\.(?:runIn|Script)|module\.exports|new\s+Function\(|\beval\(|createJiti\(|jiti\(|\b(?:spawnSync|execFileSync|execSync|spawn|execFile)\()/.test(body) && !/\breturn\s+(?:source|text|code|content)\s*;/.test(body)) functions.set(name, "runtime");
      else if (kind(node.body) === "source") functions.set(name, "source");
    }
    for (const [name, value] of variables) {
      const valueKind = kind(value, new Set([name]));
      if (valueKind === "source") sourceNames.add(name);
      if (valueKind === "runtime") runtimeNames.add(name);
    }
  }
  const assertions = [];
  for (const node of nodes) {
    if (!ts.isCallExpression(node)) continue;
    const name = node.expression.getText(tree);
    if (!/^(?:assert(?:\.[\w]+)?|expect(?:\([\s\S]*\))?\.[\w.]+|t\.(?:equal|same|ok|match|throws|rejects))$/.test(name)) continue;
    const actual = node.arguments[0];
    const valueKind = kind(actual);
    assertions.push({ line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, kind: valueKind === "source" ? "source-text" : "behaviour", expression: actual?.getText(tree).replace(/\s+/g, " ").slice(0, 200) ?? "" });
  }
  const sourceAssertions = assertions.filter((item) => item.kind === "source-text").length;
  const behaviourAssertions = assertions.length - sourceAssertions;
  const executesSource = nodes.some((node) => {
    if (ts.isImportDeclaration(node)) return /(?:^\.\.?\/src\/|^@\/)/.test(node.moduleSpecifier.text);
    if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
    const name = node.expression.getText(tree).split(".").at(-1);
    if (/^(?:jiti|createJiti|load|loadModule|loadTs|loadTS|spawn|spawnSync|execFile|execFileSync|execSync|runInNewContext|runInThisContext|runInContext|compileFunction|Function|eval)$/.test(name)) return functions.get(name) !== "source";
    return name === "require" && node.arguments.some((arg) => ts.isStringLiteralLike(arg) && /(?:^\.\.?\/src\/|^@\/)/.test(arg.text));
  });
  let classification = sourceAssertions ? (behaviourAssertions && executesSource ? "mixed" : "source-text") : "behaviour";
  let confidence = "heuristic";
  if (hasSourceRead && !sourceAssertions && !executesSource) { classification = "source-text"; confidence = "review-source-flow"; }
  if (!assertions.length) confidence = "review-no-direct-assertion";
  return { file, sha256: digest(text), classification, confidence, sourceAssertions, behaviourAssertions, hasSourceRead, executesSource, titles, assertions, targets, ticketReferences: unique((text.match(ticketPattern) ?? []).map((item) => item.toUpperCase().replace(/[_ ]/, "-"))), namedTicket: ticketPattern.test(file + " " + titles.map((item) => item.title).join(" ")) || /[-_]\d{3,}(?:[.-]|$)/.test(file), security: securityPattern.test(file + " " + text) };
}

function catalog(base) {
  const files = git("ls-tree", "-r", "--name-only", base).trim().split("\n");
  const candidates = files.filter((file) => file.startsWith("tests/") && /\.(?:test|spec)\.[^/]+$/.test(file));
  assert(candidates.length, "No tests found");
  const repositoryFiles = new Set(files);
  return candidates.map((file) => analyze(file, git("show", `${base}:${file}`), repositoryFiles));
}

function history(base, asOf) {
  assert.equal(git("rev-parse", "--is-shallow-repository").trim(), "false", "Full git history required; fetch --unshallow before classifying regressions");
  const cutoff = new Date(new Date(asOf).getTime() - 30 * 86400000).toISOString();
  const entries = git("log", base, "--format=%x1e%H%x1f%cI%x1f%s", "--name-only", "--diff-merges=first-parent", "--no-renames").split("\x1e").filter(Boolean);
  const files = new Map();
  const bugfixes = [];
  for (const entry of entries) {
    const [header, ...paths] = entry.trim().split("\n");
    const [sha, date, subject] = header.split("\x1f");
    const changed = paths.filter(Boolean);
    if (new Date(date) >= new Date(cutoff) && /\[BUGFIX\]|\b(?:fix|fixes|fixed|bugfix|regression)\b/i.test(subject)) bugfixes.push({ sha, date, subject, files: changed });
    for (const file of changed.filter((item) => item.startsWith("tests/"))) {
      if (!files.has(file)) files.set(file, []);
      files.get(file).push({ sha, date, subject });
    }
  }
  return { files, bugfixes, cutoff };
}

function decision(row, recent, failed) {
  const reasons = [];
  if (row.namedTicket) reasons.push("past ticket in filename/test name");
  if (row.security) reasons.push("access/security boundary; allowed and refused cases retained together");
  if (recent.length) reasons.push("protects a bugfix shipped within 30 days");
  if (failed.length) reasons.push("observed production CI failure (not proof of a product regression)");
  if (!reasons.length) reasons.push(row.classification === "behaviour" ? "behaviour baseline; no removal evidence" : "guarded-behaviour revert and equivalent runtime coverage unproven; retain until reviewed");
  return { call: "KEEP", reason: reasons.join("; ") };
}

function generate(evidence) {
  assert.equal(evidence.schemaVersion, 1);
  assert.match(evidence.base, /^[0-9a-f]{40}$/);
  assert(evidence.ci.runs.length, "CI run history missing");
  assert(evidence.ci.timing.records.length, "CI timing evidence missing");
  assert.equal(evidence.ci.listingComplete, true, "Incomplete CI run listing");
  assert.equal(evidence.ci.jobs.length, evidence.ci.runs.filter((run) => !["cancelled", "skipped", "neutral"].includes(run.conclusion)).length, "Missing inspected CI jobs");
  const timing = evidence.ci.timing;
  assert.equal(new Set(timing.records.map((item) => item.logLine)).size, timing.records.length, "Duplicate timing log lines");
  assert.equal(timing.records.length + timing.unattributedRecords, timing.topLevelRecords, "Timing record count mismatch");
  assert(Math.abs(timing.records.reduce((sum, item) => sum + item.seconds, 0) + timing.unattributedSeconds - timing.topLevelSeconds) < 0.00001, "Timing seconds mismatch");
  const rows = catalog(evidence.base);
  assert.equal(new Set(rows.map((row) => row.file)).size, rows.length);
  const histories = history(evidence.base, evidence.asOf);
  const knownFiles = new Set(rows.map((row) => row.file));
  const observedFailures = evidence.ci.jobs.flatMap((job) => job.failures.map((failure) => ({ ...failure, runId: job.runId, jobId: job.id, url: job.url })));
  const timingByFile = new Map();
  for (const record of evidence.ci.timing.records) {
    assert(Number.isFinite(record.seconds) && record.seconds >= 0);
    if (!timingByFile.has(record.file)) timingByFile.set(record.file, []);
    timingByFile.get(record.file).push(record);
  }
  const behaviourTargets = new Map();
  for (const row of rows.filter((item) => item.classification !== "source-text" && item.behaviourAssertions)) {
    for (const target of row.targets) {
      if (!behaviourTargets.has(target)) behaviourTargets.set(target, []);
      behaviourTargets.get(target).push(row.file);
    }
  }
  const reportRows = rows.map((row) => {
    const recent = histories.bugfixes.filter((commit) => commit.files.includes(row.file) || commit.files.some((file) => row.targets.includes(file)) || row.ticketReferences.some((ticket) => commit.subject.toUpperCase().includes(ticket)));
    const failures = observedFailures.filter((item) => item.file === row.file);
    const candidates = unique(row.targets.flatMap((target) => behaviourTargets.get(target) ?? [])).filter((file) => file !== row.file);
    const historyEntries = histories.files.get(row.file) ?? [];
    const regressionEvidence = historyEntries.filter((entry) => /\b(?:fix|fixes|fixed|regression|revert)\b|\[BUGFIX\]/i.test(entry.subject));
    const timings = timingByFile.get(row.file) ?? [];
    const { assertions, ...classification } = row;
    return {
      ...classification, ...decision(row, recent, failures),
      sourceAssertionLines: assertions.filter((item) => item.kind === "source-text").map((item) => item.line),
      nonSourceAssertionLines: assertions.filter((item) => item.kind !== "source-text").map((item) => item.line),
      protects: row.titles.find((title) => !title.suite)?.title ?? "process/indirect guard; review file",
      canFail: failures.length ? "yes: observed CI failure; cause not established" : row.assertions.length ? "assertions present; guarded-behaviour revert NOT run" : "unknown: indirect assertions/process-level checks need review",
      productionFailure: failures.length ? "observed" : "unknown: no attributed failure in retained queried window, not never",
      failures,
      regressionCaught: "unknown: git bugfix association is not evidence that this test caught the bug",
      regressionHistory: regressionEvidence,
      latestChange: historyEntries[0] ?? null,
      firstChangeAtPath: historyEntries.at(-1) ?? null,
      recentBugfixes: recent.slice(0, 3).map(({ sha }) => sha),
      recentBugfixCount: recent.length,
      behaviourCoverage: row.classification === "behaviour" ? "not applicable" : "unknown: shared target/name does not establish equivalent behaviour",
      behaviourCandidates: candidates.slice(0, 5),
      behaviourCandidateCount: candidates.length,
      sameFileBehaviour: row.classification === "mixed" && row.behaviourAssertions > 0,
      guardedRevert: "not run: inventory only; KEEP pending evidence",
      ciCallbackSeconds: Number(timings.reduce((total, item) => total + item.seconds, 0).toFixed(6)),
      ciTimingLogLines: timings.map((item) => item.logLine),
    };
  });
  const classes = Object.fromEntries(["behaviour", "source-text", "mixed"].map((name) => {
    const selected = reportRows.filter((row) => row.classification === name);
    return [name, { files: selected.length, filesWithTiming: selected.filter((row) => row.ciTimingLogLines.length).length, callbackSeconds: Number(selected.reduce((sum, row) => sum + row.ciCallbackSeconds, 0).toFixed(6)) }];
  }));
  const timingRecords = evidence.ci.timing.records;
  const unmatchedFileSeconds = timingRecords.filter((item) => !knownFiles.has(item.file)).reduce((sum, item) => sum + item.seconds, 0);
  const summary = {
    files: reportRows.length, classes,
    sourceReaders: reportRows.filter((row) => row.hasSourceRead).length,
    filesWithSourceAssertions: reportRows.filter((row) => row.sourceAssertions).length,
    reviewRequired: reportRows.filter((row) => row.confidence !== "heuristic").length,
    decisions: { KEEP: reportRows.length, REWRITE: 0, DELETE: 0 },
    filesWithObservedProductionFailures: reportRows.filter((row) => row.failures.length).length,
    filesWithRecentBugfixProtection: reportRows.filter((row) => row.recentBugfixes.length).length,
    timing: { ...evidence.ci.timing, records: undefined, unmatchedFileSeconds: Number(unmatchedFileSeconds.toFixed(6)) },
  };
  const output = { schemaVersion: 1, base: evidence.base, asOf: evidence.asOf, historyCutoff: histories.cutoff, evidenceSha256: digest(json(evidence)), summary, recentBugfixCommits: Object.fromEntries(histories.bugfixes.map(({ sha, date, subject }) => [sha, { sha, date, subject }])), tests: reportRows };
  return { output, markdown: render(output, evidence) };
}

function render(output, evidence) {
  const { summary } = output;
  const cell = (value) => String(value).replace(/\|/g, "\\|").replace(/\n/g, " ").replace(/</g, "&lt;");
  const link = (file, line = 1) => `[${file}:${line}](https://github.com/hypertask-ai/hypertask/blob/${output.base}/${file}#L${line})`;
  const header = `# Test classification — inventory only\n\nTicket: https://app.hypertask.ai/detail/project-4060/677\n\nPinned production tree: \`${output.base}\`; as of ${output.asOf}. Reproduce with \`node scripts/test-inventory/inventory.mjs --check\`. See [method and limitations](../../scripts/test-inventory/README.md). Complete per-assertion lines, titles (including dynamic templates), guarded paths, history links (commit SHA), sampled overlap candidates and CI log line evidence are in [inventory.json](inventory.json); sanitized read-only GitHub inputs are in [evidence.json](evidence.json).\n\n## Reconciled numbers\n\n${summary.files} test/spec files under tests/ (helpers and fixtures without a test/spec suffix are excluded, including reads made only by helpers). ${summary.sourceReaders} files have a recognized source-read flow; ${summary.filesWithSourceAssertions} have directly source-tainted assertions. These are current-tree measurements, not the ticket's older approximate counts. ${summary.reviewRequired} files need source-flow/no-direct-assertion review. Classification is a static heuristic, **not proof of behavioural quality**.\n\n| Class | Files | Files with attributed timing | Reported callback seconds |\n| --- | ---: | ---: | ---: |\n${Object.entries(summary.classes).map(([name, data]) => `| ${name} | ${data.files} | ${data.filesWithTiming} | ${data.callbackSeconds.toFixed(6)} |`).join("\n")}\n\n**Timing denominator:** one successful production full-suite job, [${evidence.ci.timing.jobId}](${evidence.ci.timing.url}), commit \`${evidence.ci.timing.sha}\`. Full-suite step wall time: **${evidence.ci.timing.stepWallSeconds} s**. Matched top-level callback/file-result durations are summed, not divided by four workers and not presented as removable wall time. Total top-level reported duration: **${evidence.ci.timing.topLevelSeconds} s** (${evidence.ci.timing.topLevelRecords} records), reconciled as the three classes plus unmatched-file and unattributed seconds. Unattributed top-level callback duration: **${evidence.ci.timing.unattributedSeconds} s** (${evidence.ci.timing.unattributedRecords} records). Timed historical files absent from this tree: **${summary.timing.unmatchedFileSeconds} s**. Nested callbacks are excluded to avoid double counting; dynamic/duplicate names remain unattributed. Process startup, setup, teardown, tsx overhead and idle/concurrency overlap cannot be apportioned from this reporter. Missing file timing is **unknown, never zero cost**. No full suite was run locally.\n\n**History denominator:** ${evidence.ci.runs.length} completed production push CI Tests runs in ${evidence.ci.from} through ${evidence.ci.to}; ${evidence.ci.jobs.length} ci-tests jobs inspected; ${evidence.ci.jobs.filter((job) => job.logStatus === "parsed").length} logs parsed; ${evidence.ci.jobs.filter((job) => job.logStatus === "unavailable").length} logs unavailable. ${summary.filesWithObservedProductionFailures} current files have an attributed failure. A green job does not prove no failures before this window. Cancelled/in-progress runs and expired logs are not negative evidence. Git history is all history reachable from the pinned production tree, exact path only (no rename following); bugfix association uses a conservative 30-day commit-subject/path/ticket match. A failure proves a test can go red, **not that it caught a production defect**.\n\n## Decision policy\n\nKEEP ${summary.decisions.KEEP}; REWRITE 0; DELETE 0. This is a conservative first inventory, **not a deletion/rewrite authorization**. Past tickets in filenames/test names (plus numeric filename suffixes), access/security tests with their allowed cases, and recent bugfix associations are forced KEEP. Every other existing test remains KEEP until a guarded-behaviour revert and equivalent behaviour coverage are established. This preserves every test that would fail under a revert without pretending to have run thousands of mutations. Git association, source inspection, shared target and a historical red are not causal regression proof. Overlap is recorded as candidates, not an unsubstantiated yes/no. The report explicitly retains unknowns instead of inventing "never failed", "duplicate", or "cannot fail".\n\n## One row per test file\n\n"No attributed failure" means unknown outside the queried/retained logs. "Revert not run" means can-fail-for-behaviour is unproven. A dash for timing is missing attribution. Titles are stated intent, not verified protection. Full details for every row are in inventory.json.\n\n| Test / class | Protects (first declared test; full list in JSON) | Can fail / production failure / regression evidence | Behaviour overlap | Call / reason / evidence | Callback s |\n| --- | --- | --- | --- | --- | ---: |\n`;
  return header + output.tests.map((row) => {
    const failure = row.failures[0];
    const change = row.latestChange;
    const historyLink = change ? `[git](https://github.com/hypertask-ai/hypertask/commit/${change.sha.slice(0, 12)})` : "no path history";
    const failed = failure ? `[observed failure](${failure.url})` : "no attributed failure (unknown)";
    const recent = output.recentBugfixCommits[row.recentBugfixes[0]];
    const bugfix = recent ? `; [recent bugfix](https://github.com/hypertask-ai/hypertask/commit/${recent.sha.slice(0, 12)})` : "";
    const overlap = row.classification === "behaviour" ? "n/a" : `${row.behaviourCandidateCount} shared-target candidates${row.sameFileBehaviour ? "; also runtime assertions in file" : ""}; equivalence unknown`;
    return `| ${link(row.file)} / ${row.classification} (${row.confidence}) | ${cell(row.protects)} | ${failed}; revert not run; regression caught unknown | ${overlap} | **${row.call}**: ${cell(row.reason)}; ${historyLink}${bugfix} | ${row.ciTimingLogLines.length ? row.ciCallbackSeconds.toFixed(6) : "—"} |`;
  }).join("\n") + "\n";
}

function selfTest() {
  const cases = [
    ["behaviour", `const test=require('node:test'); const assert=require('node:assert/strict'); const {sum}=require('../src/sum'); test('adds',()=>assert.equal(sum(1,2),3));`],
    ["source-text", `const fs=require('node:fs'); const assert=require('node:assert/strict'); const source=fs.readFileSync('src/a.ts','utf8'); assert.match(source,/guard/);`],
    ["mixed", `const fs=require('node:fs'); const assert=require('node:assert/strict'); const {sum}=require('../src/sum'); const source=fs.readFileSync('src/a.ts','utf8'); assert.match(source,/guard/); assert.equal(sum(1,2),3);`],
    ["source-text", `const assert=require('node:assert/strict'); const {readAgentChatSource}=require('./helpers/source'); const source=readAgentChatSource(); const body=source.slice(2); assert.ok(body.includes('guard'));`],
    ["behaviour", `const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'); function loadModule(){ const code=fs.readFileSync('src/a.ts','utf8'); const module={exports:{}}; vm.runInNewContext(code,{module}); return module.exports; } const subject=loadModule(); assert.equal(subject.run(),42);`],
    ["behaviour", `const fs=require('node:fs'),assert=require('node:assert/strict'); const result=JSON.parse(fs.readFileSync(fixture,'utf8')); assert.equal(result.status,'ok');`],
    ["behaviour", `const fs=require('node:fs'),assert=require('node:assert/strict'); const source=fs.readFileSync('src/a.ts','utf8'); function loadSubject(){const module={exports:{}}; new Function('module',source)(module); return module.exports;} const subject=loadSubject(); assert.equal(subject.run(),42);`],
    ["source-text", `const {readFileSync: read}=require('node:fs'); const assert=require('node:assert/strict'); const source=read('src/a.ts','utf8'); assert.match(source,/guard/);`],
    ["behaviour", `const fs=require('node:fs'),assert=require('node:assert/strict'); const baseline=JSON.parse(fs.readFileSync('config/base.json','utf8')); const runChecker=()=>spawnSync('node',['scripts/check.mjs',baseline]); const result=runChecker(); assert.equal(result.status,0);`],
    ["behaviour", `const fs=require('node:fs'),assert=require('node:assert/strict'); const source=fs.readFileSync('src/a.ts','utf8'); const subject=h.load('src/a.ts',source); assert.equal(subject.run(),42);`],
  ];
  for (const [expected, source] of cases) assert.equal(analyze("tests/example.test.cjs", source).classification, expected, source);
  assert.deepEqual(analyze("tests/a.test.ts", 'import {sum} from "../src/sum";', new Set(["src/sum.ts"])).targets, ["src/sum.ts"]);
  assert.equal(analyze("tests/a.test.cjs", 'test(`case ${value}`,()=>assert.equal(value,1));').titles[0].dynamic, true);
  const ticket = analyze("tests/htpr-1234.test.cjs", cases[1][1]);
  assert.equal(decision(ticket, [], []).call, "KEEP");
  assert.match(decision(ticket, [], []).reason, /past ticket/);
  const numbered = analyze("tests/regression-7518.test.cjs", cases[1][1]);
  assert(numbered.namedTicket);
  const security = analyze("tests/access.test.cjs", `${cases[0][1]} test('still allowed for signed session',()=>assert.equal(sum(1,2),3));`);
  assert.match(decision(security, [], []).reason, /access\/security/);
  assert.match(decision(analyze("tests/a.test.cjs", cases[1][1]), [{ sha: "fixture" }], []).reason, /30 days/);
  assert.match(decision(analyze("tests/a.test.cjs", cases[1][1]), [], []).reason, /revert/);
  assert.throws(() => generate({ schemaVersion: 1, base: "a".repeat(40), ci: { runs: [], timing: { records: [] } } }), /history missing/);
  assert.throws(() => generate({ schemaVersion: 1, base: "a".repeat(40), ci: { runs: [{}], timing: { records: [{}] }, listingComplete: false } }), /Incomplete CI/);
  assert(inScope("docs/test-inventory/report.md"));
  assert.equal(inScope("tests/existing.test.cjs"), false);
  assert.equal(inScope("src/lib/flags/definitions/new.ts"), false);
  assert.equal(inScope(".github/workflows/ci-tests.yml"), false);
  console.log("inventory self-test passed");
}

const option = process.argv[2];
if (option === "--self-test") selfTest();
else if (option === "--catalog") console.log(json(catalog(process.argv[3] ?? "origin/production")));
else if (option === "--check-scope") {
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const changed = unique([...git("diff", "--no-renames", "--name-only", evidence.base).trim().split("\n"), ...git("ls-files", "--others", "--exclude-standard").trim().split("\n")].filter(Boolean));
  assert(changed.length);
  assert(changed.every(inScope), `Out-of-scope changes: ${changed.join(", ")}`);
  console.log("inventory scope passed");
} else if (option === "--write" || option === "--check") {
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const { output, markdown } = generate(evidence);
  const metadata = json({ ...output, tests: undefined }).trimEnd().slice(0, -1).trimEnd();
  const inventory = `${metadata},\n  "tests": [\n${output.tests.map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]\n}\n`;
  const files = { [`${directory}/inventory.json`]: inventory, [`${directory}/report.md`]: markdown };
  for (const [file, contents] of Object.entries(files)) {
    if (option === "--write") writeFileSync(file, contents);
    else assert.equal(readFileSync(file, "utf8"), contents, `Stale report: ${file}; rerun --write`);
  }
  console.log(option === "--check" ? "inventory reproduction passed" : `inventory written: ${output.summary.files} files`);
} else throw new Error("Use --self-test, --catalog [git-ref], --write, --check or --check-scope; see README.md");
