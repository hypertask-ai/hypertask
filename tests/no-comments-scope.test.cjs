const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const loaded = import("../scripts/check-no-comments.mjs");

function fixture(files) {
  const directory = mkdtempSync(path.join(root, ".no-comments-test-"));
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    writeFileSync(path.join(directory, name), contents);
  }
  return directory;
}

const narrative = [
  "Verify the reviewed head before approving, because a review of the previous",
  "head can land after a new push and mark it successful.",
];

test("a prose comment in a GitHub script fails with the required message", async () => {
  const { check } = await loaded;
  const directory = fixture({ ".github/scripts/probe.cjs": `// ${narrative[0]}\nmodule.exports = 1;\n` });
  try {
    const { violations } = check([".github/scripts/probe.cjs"], {}, directory);
    assert.deepEqual(violations, [
      "Comment in .github/scripts/probe.cjs:1. Remove it and name the intent in code.",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the tool markers a GitHub script needs still pass", async () => {
  const { disallowedComments } = await loaded;
  const source = [
    "#!/usr/bin/env node",
    "// eslint-disable-next-line no-console",
    "// @ts-expect-error the release has no types",
    "console.log(process.argv);",
    "",
  ].join("\n");
  assert.deepEqual(disallowedComments(source, ".github/scripts/marker.cjs"), []);
});

test("a workflow prose comment fails and tool pragmas still pass", async () => {
  const { disallowedComments } = await loaded;
  const source = [
    "name: Probe",
    "",
    "# This sweep exists because GitHub dropped 17 of 349 scheduled runs.",
    "# renovate: datasource=npm",
    "# shellcheck disable=SC2086",
    "on:",
    "  schedule:",
    "    - cron: '*/10 * * * *'",
    "",
  ].join("\n");
  const found = disallowedComments(source, ".github/workflows/probe.yml");
  assert.deepEqual(found.map((comment) => comment.line), [3]);
});

test("shell, Python and extensionless scripts follow the same rule", async () => {
  const { disallowedComments } = await loaded;
  const shell = [
    "#!/usr/bin/env bash",
    "# Reads the drift between production and the live app.",
    "# shellcheck disable=SC2086",
    "set -euo pipefail",
    "",
  ].join("\n");
  assert.deepEqual(disallowedComments(shell, ".github/scripts/probe.sh").map((comment) => comment.line), [2]);
  const python = [
    "import os",
    "# noqa",
    "# Walks the route surface.",
    "",
  ].join("\n");
  assert.deepEqual(disallowedComments(python, ".github/scripts/probe.py").map((comment) => comment.line), [3]);
  const executable = "#!/bin/sh\n# Dispatches the review.\nexec true\n";
  assert.deepEqual(disallowedComments(executable, ".github/scripts/dispatch-review").map((comment) => comment.line), [2]);
  assert.throws(() => disallowedComments("plain text\n", ".github/scripts/notes.txt"), /not a script or a workflow file/);
});

test("a baselined file keeps its allowance and rejects the next comment", async () => {
  const { check } = await loaded;
  const prose = (count) => `${Array.from({ length: count }, () => "# narrative").join("\n")}\nname: Probe\n`;
  const directory = fixture({ ".github/workflows/probe.yml": prose(3) });
  try {
    const baseline = { ".github/workflows/probe.yml": 2 };
    assert.equal(check([".github/workflows/probe.yml"], baseline, directory).violations.length, 1);
    assert.equal(check([".github/workflows/probe.yml"], { ".github/workflows/probe.yml": 3 }, directory).violations.length, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the repository itself is green and every allowance is still needed", async () => {
  const { check, defaultFiles, loadBaseline } = await loaded;
  const files = defaultFiles();
  const baseline = loadBaseline();
  const { violations, stale } = check(files, baseline, process.cwd());
  assert.deepEqual(violations, []);
  assert.deepEqual(stale, []);
  assert.ok(files.length >= 100);
});

test("the narrative comments from pull request 3070 fail the check", async () => {
  const { check } = await loaded;
  const original = readFileSync(path.join(root, ".github/scripts/codex-review-gate.cjs"), "utf8");
  const directory = fixture({
    ".github/scripts/codex-review-gate.cjs": `${narrative.map((line) => `// ${line}`).join("\n")}\n${original}`,
  });
  try {
    const { violations } = check([".github/scripts/codex-review-gate.cjs"], {}, directory);
    assert.deepEqual(violations, [
      "Comment in .github/scripts/codex-review-gate.cjs:1. Remove it and name the intent in code.",
      "Comment in .github/scripts/codex-review-gate.cjs:2. Remove it and name the intent in code.",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
