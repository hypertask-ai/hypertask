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
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
printf "%s\\n" "$@" >> "$MOCK_ARGS"
case "$*" in
  *"/pulls/42"*) printf "%s\\n" "\${MOCK_LIVE_HEAD:-$PR_HEAD_SHA}" ;;
  *"/check-suites?"*) cat "$MOCK_SUITES" ;;
  *"/timeline?"*) cat "$MOCK_TIMELINE" ;;
  *"/events?"*) cat "$MOCK_EVENTS" ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  const events = path.join(dir, "events");
  const suites = path.join(dir, "suites");
  const timeline = path.join(dir, "timeline");
  const args = path.join(dir, "args");
  fs.writeFileSync(events, "");
  fs.writeFileSync(timeline, "");
  fs.writeFileSync(suites, JSON.stringify({ head_sha: git(["rev-parse", "HEAD"]), created_at: "2026-09-27T10:00:00Z" }) + "\n");
  return {
    dir, events, suites, timeline, args, git,
    run(labels, approvers, overrides = {}) {
      const env = {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_EVENTS: events, MOCK_ARGS: args,
        MOCK_SUITES: suites, MOCK_TIMELINE: timeline,
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

function labelEvent(id, actor, overrides = {}) {
  return JSON.stringify({ id, event: "labeled", created_at: "2026-09-27T11:00:00Z",
    actor, actor_type: "User", app: null, ...overrides }) + "\n";
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
  fs.writeFileSync(f.events, labelEvent(12, "valentinyeo") + labelEvent(20, "agent") + labelEvent(15, "valentinyeo"));
  const rejected = f.run([{ name: "intentional-revert" }]);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /requires a direct HUMAN_APPROVERS label.*actor: agent/);
  assert.match(fs.readFileSync(f.args, "utf8"), /issues\/42\/events\?per_page=100/);
  assert.match(fs.readFileSync(f.args, "utf8"), /--paginate/);

  fs.writeFileSync(f.events, labelEvent(12, "agent") + labelEvent(20, "VaLeNtInYeO"));
  const allowed = f.run([{ name: "intentional-revert" }]);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /skipped/);
});

test("configured comma-separated approvers replace the default", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, labelEvent(20, "other-human"));
  assert.equal(f.run(["intentional-revert"]).status, 1);
  assert.equal(f.run(["intentional-revert"], " someone, Other-Human ").status, 0);
  fs.writeFileSync(f.events, labelEvent(20, "valentinyeo"));
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
  fs.writeFileSync(f.events, labelEvent(12, "valentinyeo") + labelEvent(20, "valentinyeo", { app: { slug: "bot" } }));
  assert.equal(f.run(["intentional-revert"]).status, 1);
  fs.writeFileSync(f.events, labelEvent(20, "valentinyeo"));
  const result = f.run(["intentional-revert"], undefined, { PR_HEAD_IS_FORK: "true" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a direct HUMAN_APPROVERS label/);
});

test("PR .gitattributes cannot hide deleted source lines as binary", (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, "code.js"), "first();\nsecond();\nthird();\n");
  f.git(["add", "code.js"]);
  f.git(["commit", "-q", "-m", "recent fix"]);
  f.git(["update-ref", "refs/remotes/origin/production", f.git(["rev-parse", "HEAD"])]);
  fs.writeFileSync(path.join(f.dir, "code.js"), "");
  fs.writeFileSync(path.join(f.dir, ".gitattributes"), "*.js -diff\n");
  f.git(["add", "code.js", ".gitattributes"]);
  f.git(["commit", "-q", "-m", "clobber fix"]);
  const result = f.run([]);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /recent fix[\s\S]*code\.js: 3 deleted line/);
});

test("approval before head arrival fails, including a later timeline push", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, labelEvent(20, "valentinyeo"));
  fs.writeFileSync(f.suites, JSON.stringify({ head_sha: f.git(["rev-parse", "HEAD"]), created_at: "2026-09-27T12:00:00Z" }) + "\n");
  assert.equal(f.run(["intentional-revert"]).status, 1);
  fs.writeFileSync(f.suites, JSON.stringify({ head_sha: f.git(["rev-parse", "HEAD"]), created_at: "2026-09-27T10:00:00Z" }) + "\n");
  fs.writeFileSync(f.timeline, JSON.stringify({ event: "head_ref_force_pushed", after: f.git(["rev-parse", "HEAD"]), created_at: "2026-09-27T12:00:00Z" }) + "\n");
  assert.equal(f.run(["intentional-revert"]).status, 1);
});

test("check suites created by labeling do not invalidate a fresh approval", (t) => {
  const f = fixture(t);
  const head = f.git(["rev-parse", "HEAD"]);
  fs.writeFileSync(f.events, labelEvent(20, "valentinyeo"));
  fs.writeFileSync(f.suites, [
    { head_sha: head, created_at: "2026-09-27T10:00:00Z" },
    { head_sha: head, created_at: "2026-09-27T12:00:00Z" },
  ].map((suite) => JSON.stringify(suite)).join("\n") + "\n");
  assert.equal(f.run(["intentional-revert"]).status, 0);
});

test("a later unlabel invalidates even a human approval", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, labelEvent(20, "valentinyeo") + labelEvent(21, "agent", { event: "unlabeled", created_at: "2026-09-27T12:00:00Z" }));
  assert.equal(f.run(["intentional-revert"]).status, 1);
  fs.appendFileSync(f.events, labelEvent(22, "valentinyeo", { created_at: "2026-09-27T13:00:00Z" }));
  assert.equal(f.run(["intentional-revert"]).status, 0);
});

test("missing head arrival timestamp fails closed", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, labelEvent(20, "valentinyeo"));
  fs.writeFileSync(f.suites, "");
  const result = f.run(["intentional-revert"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a direct HUMAN_APPROVERS label/);
});

test("a committed timeline event can establish head arrival without a check suite", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, labelEvent(20, "valentinyeo"));
  fs.writeFileSync(f.suites, "");
  fs.writeFileSync(f.timeline, JSON.stringify({ event: "committed", commit_id: f.git(["rev-parse", "HEAD"]), created_at: "2026-09-27T10:00:00Z" }) + "\n");
  assert.equal(f.run(["intentional-revert"]).status, 0);
});

test("only a direct user label on the live head can approve", (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.events, labelEvent(20, "valentinyeo", { actor_type: "Bot" }));
  assert.equal(f.run(["intentional-revert"]).status, 1);
  fs.writeFileSync(f.events, labelEvent(20, "valentinyeo"));
  const result = f.run(["intentional-revert"], undefined, { MOCK_LIVE_HEAD: "0".repeat(40) });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /PR head changed/);
});

test("both label reads paginate and assemble labels across pages", () => {
  const guard = fs.readFileSync(path.join(root, ".github/workflows/revert-guard.yml"), "utf8");
  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci-tests.yml"), "utf8");
  for (const workflow of [guard, ci]) {
    assert.match(workflow, /gh api --paginate "repos\/\$\{\{ github\.repository \}\}\/issues\/\$PR_NUMBER\/labels\?per_page=100"/);
    assert.match(workflow, /PR_LABELS=\$\(printf '%s\\n' "\$PR_LABELS" \| jq -s '\.'\)/);
  }
  assert.match(guard, /labels=\$\(gh api --paginate/);
  const labels = Array.from({ length: 101 }, (_, i) => ({ name: i === 100 ? "intentional-revert" : `label-${i}` }));
  const result = spawnSync("jq", ["-s", "."], { input: labels.map(JSON.stringify).join("\n"), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), labels);
});

test("both workflow invocations load the base script and fresh approval follows pushes", () => {
  const guard = fs.readFileSync(path.join(root, ".github/workflows/revert-guard.yml"), "utf8");
  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci-tests.yml"), "utf8");
  assert.match(guard, /types: \[opened, synchronize, reopened, edited, labeled, unlabeled\]/);
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
