const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const script = path.join(root, ".github/scripts/revert-guard.mjs");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "revert-guard-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git(["init", "-q"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "file.txt"), "original\n");
  git(["add", "file.txt"]);
  git(["commit", "-q", "-m", "base"]);
  git(["update-ref", "refs/remotes/origin/production", git(["rev-parse", "HEAD"])]);
  fs.writeFileSync(path.join(dir, "file.txt"), "original\nnew\n");
  git(["add", "file.txt"]);
  git(["commit", "-q", "-m", "head"]);

  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "gh"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$MOCK_ARGS"\ncat "$MOCK_EVENTS"\n', { mode: 0o755 });
  const events = path.join(dir, "events");
  const args = path.join(dir, "args");
  return {
    dir, events, args,
    run(labels, approvers, overrides = {}) {
      const env = {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_EVENTS: events, MOCK_ARGS: args,
        GITHUB_REPOSITORY: "owner/repo", PR_NUMBER: "42", GITHUB_BASE_REF: "production",
        PR_HEAD_SHA: git(["rev-parse", "HEAD"]), PR_LABELS: JSON.stringify(labels),
      };
      if (approvers === undefined) delete env.HUMAN_APPROVERS;
      else env.HUMAN_APPROVERS = approvers;
      Object.assign(env, overrides);
      return spawnSync(process.execPath, [script], { cwd: dir, env, encoding: "utf8" });
    },
  };
}

test("unlabeled PR keeps the ordinary diff check without fetching events", (t) => {
  const f = fixture(t);
  const result = f.run([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /removes no lines/);
  assert.equal(fs.existsSync(f.args), false);
});

test("only the latest matching label event can authorize the override", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, '{"id":12,"actor":"valentinyeo","app":null}\n{"id":20,"actor":"agent","app":null}\n{"id":15,"actor":"valentinyeo","app":null}\n');
  const rejected = f.run([{ name: "intentional-revert" }]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /not added directly by a HUMAN_APPROVERS login.*actor: agent/);
  assert.match(fs.readFileSync(f.args, "utf8"), /issues\/42\/events\?per_page=100/);
  assert.match(fs.readFileSync(f.args, "utf8"), /--paginate/);

  fs.writeFileSync(f.events, '{"id":12,"actor":"agent","app":null}\n{"id":20,"actor":"VaLeNtInYeO","app":null}\n');
  const allowed = f.run([{ name: "intentional-revert" }]);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /skipped/);
});

test("configured comma-separated approvers replace the default", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, '{"id":20,"actor":"other-human","app":null}\n');
  assert.equal(f.run(["intentional-revert"]).status, 1);
  assert.equal(f.run(["intentional-revert"], " someone, Other-Human ").status, 0);
  fs.writeFileSync(f.events, '{"id":20,"actor":"valentinyeo","app":null}\n');
  assert.equal(f.run(["intentional-revert"], "other-human").status, 1);
});

test("label without an auditable labeled event fails closed", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, "");
  const result = f.run(["intentional-revert"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /actor: unknown \(no matching labeled event\)/);
});

test("app-mediated labels and fork labels cannot authorize an override", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, '{"id":12,"actor":"valentinyeo","app":null}\n{"id":20,"actor":"valentinyeo","app":{"slug":"bot"}}\n');
  assert.equal(f.run(["intentional-revert"]).status, 1);
  fs.writeFileSync(f.events, '{"id":20,"actor":"valentinyeo","app":null}\n');
  const result = f.run(["intentional-revert"], undefined, { PR_HEAD_IS_FORK: "true" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not added directly/);
});

test("both workflow invocations load the base script and fresh approval follows pushes", () => {
  const guard = fs.readFileSync(path.join(root, ".github/workflows/revert-guard.yml"), "utf8");
  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci-tests.yml"), "utf8");
  assert.match(guard, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
  for (const workflow of [guard, ci]) {
    assert.match(workflow, /HUMAN_APPROVERS: \$\{\{ vars\.HUMAN_APPROVERS \|\| 'valentinyeo' \}\}/);
    assert.match(workflow, /git fetch --quiet origin "\$GITHUB_BASE_REF:refs\/remotes\/origin\/\$GITHUB_BASE_REF"/);
    assert.match(workflow, /git show "origin\/\$GITHUB_BASE_REF:\.github\/scripts\/revert-guard\.mjs" > "\$RUNNER_TEMP\/rg\.mjs"/);
    assert.match(workflow, /node "\$RUNNER_TEMP\/rg\.mjs"/);
    assert.match(workflow, /PR_HEAD_IS_FORK: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name != github\.repository \}\}/);
  }
  assert.match(guard, /clear-revert-label:\n    if: github\.event\.action == 'synchronize' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(guard, /clear-revert-label:[\s\S]*?permissions:\n      pull-requests: write\n      issues: write/);
  assert.match(guard, /gh api -X DELETE "repos\/\$\{\{ github\.repository \}\}\/issues\/\$PR_NUMBER\/labels\/intentional-revert"/);
  assert.match(guard, /needs: clear-revert-label/);
  assert.match(guard, /needs\.clear-revert-label\.result != 'success'/);
  assert.match(guard, /revert-guard:\n    name: revert-guard[\s\S]*?concurrency:\n      group: revert-guard-/);
  assert.doesNotMatch(guard, /^concurrency:/m);
});
