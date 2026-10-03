const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const BASE_SHA = "db9dc34c03378f6bb3d67e6bcaf696fbe0467f7f";
const changedTs = [
  "src/lib/ai/chatAlerts/policy.ts", "src/lib/ai/chatAlerts/store.ts",
  "src/lib/ai/chatAlerts/manager.ts", "src/lib/ai/chatAlerts/service.ts",
  "src/lib/ai/chatStream/runStream.ts", "src/lib/agentWebhooks/delivery.ts", "src/lib/flags.ts", "src/lib/flags/keys.ts",
  "src/app/api/cron/native-agent-heartbeat/route.ts",
];
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

function types() {
  const ts = require("typescript");
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const options = { ...parsed.options, incremental: false, noEmit: true };
  const overlay = new Map();
  for (const file of changedTs.filter((file) => !file.startsWith("src/lib/ai/chatAlerts/"))) {
    overlay.set(path.join(root, file), git("show", `${BASE_SHA}:${file}`));
  }
  function diagnostics(baseline) {
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile;
    if (baseline) host.getSourceFile = (file, version, ...args) => overlay.has(file)
      ? ts.createSourceFile(file, overlay.get(file), version, true)
      : original(file, version, ...args);
    const fileNames = baseline ? parsed.fileNames.filter((file) => !file.includes("/src/lib/ai/chatAlerts/")) : parsed.fileNames;
    const program = ts.createProgram(fileNames, options, host);
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
      file: diagnostic.file ? path.relative(root, diagnostic.file.fileName) : "config",
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    }));
  }
  const baseline = diagnostics(true);
  const head = diagnostics(false);
  const counts = new Map();
  for (const diagnostic of baseline) {
    const key = JSON.stringify(diagnostic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const added = head.filter((diagnostic) => {
    const key = JSON.stringify(diagnostic);
    const count = counts.get(key) ?? 0;
    if (!count) return true;
    counts.set(key, count - 1);
    return false;
  });
  assert.deepEqual(added, [], "New TypeScript diagnostics compared with the initial branch base");
  assert.deepEqual(head.filter((diagnostic) => changedTs.includes(diagnostic.file)), [], "Changed TypeScript files have diagnostics");
  console.log(`Scoped typecheck passed: ${head.length} existing diagnostics, ${baseline.length} baseline diagnostics, no new errors`);
}

function lint() {
  const files = [...changedTs, "scripts/verify-ai-chat-alerts.cjs", "tests/ai-chat-alerts.test.cjs", "tests/ai-chat-alerts-integration.test.cjs", "tests/feature-flags.test.cjs"];
  for (const file of files) {
    // stdin overrides the package script's dot target, so only this file is linted.
    const result = spawnSync("npm", ["run", "lint", "--", "--stdin", "--stdin-filename", file], {
      cwd: root, input: fs.readFileSync(path.join(root, file)), encoding: "utf8",
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    assert.equal(result.status, 0, `Lint failed: ${file}`);
  }
  console.log(`Changed-file lint passed: ${files.length} files`);
}

function hygiene() {
  const files = [...new Set([...git("diff", "--name-only", BASE_SHA).trim().split("\n"), ...git("ls-files", "--others", "--exclude-standard").trim().split("\n")])].filter(Boolean);
  const allowed = /^(GATES\.md|src\/lib\/ai\/chatAlerts\/[^/]+\.ts|src\/lib\/ai\/chatStream\/runStream\.ts|src\/lib\/agentWebhooks\/delivery\.ts|src\/lib\/flags(?:\/keys)?\.ts|src\/app\/api\/cron\/native-agent-heartbeat\/route\.ts|src\/prisma\/schema\.prisma|src\/prisma\/migrations\/20261003230000_add_ai_chat_alerts\/migration\.sql|tests\/ai-chat-alerts(?:-integration)?\.test\.cjs|tests\/feature-flags\.test\.cjs|scripts\/verify-ai-chat-alerts\.cjs|docs\/ai-chat-alerts\.md)$/;
  for (const file of files) assert.match(file, allowed, `Unexpected changed file: ${file}`);
  const added = git("diff", "--unified=0", BASE_SHA).split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  for (const file of files.filter((file) => !git("ls-files", file).trim())) added.push(fs.readFileSync(path.join(root, file), "utf8"));
  const hasEmDash = (text) => text.includes(String.fromCodePoint(0x2014));
  assert.equal(hasEmDash(String.fromCodePoint(0x2014)), true, "Negative check positive control");
  assert.equal(added.some(hasEmDash), false, "Added content contains an em dash");
  assert.equal(git("diff", BASE_SHA, "--", "src/lib/telemetry/aiChatObservability.ts"), "", "Existing tracking was modified");
  git("diff", "--check");
  assert.equal(git("branch", "--show-current").trim(), "htpr-6354");
  console.log("Diff hygiene passed");
}

function commit() {
  const commits = git("rev-list", `${BASE_SHA}..HEAD`).trim().split("\n").filter(Boolean);
  assert.ok(commits.length > 0);
  for (const sha of commits) {
    assert.match(git("show", "-s", "--format=%B", sha), /^HTPR-6354: .+\n[\s\S]*Co-Authored-By: Claude Opus 5\.5 <noreply@anthropic\.com>\s*$/);
  }
  assert.equal(git("branch", "--show-current").trim(), "htpr-6354");
  assert.equal(git("for-each-ref", "--format=%(refname)", "refs/remotes/origin/htpr-6354").trim(), "");
  console.log("Requested local commit verified");
}

const commands = { types, lint, hygiene, commit };
const command = process.argv[2];
assert.ok(Object.hasOwn(commands, command), "Expected types, lint, hygiene or commit");
commands[command]();
