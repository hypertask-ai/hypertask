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
    run(labels, approvers) {
      const env = {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_EVENTS: events, MOCK_ARGS: args,
        GITHUB_REPOSITORY: "owner/repo", PR_NUMBER: "42", GITHUB_BASE_REF: "production",
        PR_HEAD_SHA: git(["rev-parse", "HEAD"]), PR_LABELS: JSON.stringify(labels),
      };
      if (approvers === undefined) delete env.HUMAN_APPROVERS;
      else env.HUMAN_APPROVERS = approvers;
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
  fs.writeFileSync(f.events, "12\tvalentinyeo\n20\tagent\n15\tvalentinyeo\n");
  const rejected = f.run([{ name: "intentional-revert" }]);
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stderr.trim(), "Revert Guard failed: intentional-revert was added by agent, not a HUMAN_APPROVERS login.");
  assert.match(fs.readFileSync(f.args, "utf8"), /issues\/42\/events\?per_page=100/);
  assert.match(fs.readFileSync(f.args, "utf8"), /--paginate/);

  fs.writeFileSync(f.events, "12\tagent\n20\tVaLeNtInYeO\n");
  const allowed = f.run([{ name: "intentional-revert" }]);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /skipped/);
});

test("configured comma-separated approvers replace the default", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, "20\tother-human\n");
  assert.equal(f.run(["intentional-revert"]).status, 1);
  assert.equal(f.run(["intentional-revert"], " someone, Other-Human ").status, 0);
  fs.writeFileSync(f.events, "20\tvalentinyeo\n");
  assert.equal(f.run(["intentional-revert"], "other-human").status, 1);
});

test("label without an auditable labeled event fails closed", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, "");
  const result = f.run(["intentional-revert"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /added by unknown \(no matching labeled event\)/);
});

test("both workflow invocations pass approvers and revert-guard reruns on label changes", () => {
  const guard = fs.readFileSync(path.join(root, ".github/workflows/revert-guard.yml"), "utf8");
  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci-tests.yml"), "utf8");
  assert.match(guard, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
  for (const workflow of [guard, ci]) {
    assert.match(workflow, /HUMAN_APPROVERS: \$\{\{ vars\.HUMAN_APPROVERS \|\| 'valentinyeo' \}\}/);
  }
});
