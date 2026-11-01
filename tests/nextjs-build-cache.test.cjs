const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const { runInNewContext } = require("node:vm");
const yaml = require("js-yaml");

const workflow = yaml.load(readFileSync(".github/workflows/ci-tests.yml", "utf8"));
const BUILDER = "browser-build";
const SHARDS = ["browser-smoke-desktop", "browser-smoke-mobile", "browser-smoke-matrix", "browser-smoke-flags"];
const steps = workflow.jobs[BUILDER].steps;
const save = steps.find(step => step.name === "Save Next.js build cache");
const build = steps.find(step => step.name === "Build the local app (no migrations)");
const restore = steps.find(step => step.id === "restore-nextjs-cache");

test("the one build restores only the matching Next.js incremental build cache before building", () => {
  const cacheSha = readFileSync(".github/actions/action-archive-cache-manifest.txt", "utf8")
    .match(/^actions\/cache ([a-f0-9]{40}) /m)[1];
  assert.equal(restore.uses, `actions/cache/restore@${cacheSha}`);
  assert.equal(restore.with.path, ".next/cache");
  assert.equal(restore.if, build.if);
  assert.ok(steps.indexOf(restore) < steps.indexOf(build));
  assert.equal(restore.with.key, "nextjs-${{ runner.os }}-${{ hashFiles('package-lock.json', 'next.config.*') }}-${{ github.sha }}");
  assert.equal(restore.with["restore-keys"].trim(), restore.with.key.replace("${{ github.sha }}", ""));
  for (const key of SHARDS) {
    assert.ok(!workflow.jobs[key].steps.some(step => step.id === "restore-nextjs-cache"), key);
    assert.ok(!workflow.jobs[key].steps.some(step => step.name === "Build the local app (no migrations)"), key);
  }
  assert.equal(workflow.on.push.branches.includes("production"), true);
});

test("browser-smoke runs on pushes and on ready pull requests, never on drafts", () => {
  for (const [github, expected] of [
    [{ event_name: "push" }, true],
    [{ event_name: "push", event: {} }, true],
    [{ event_name: "push", event: { pull_request: { draft: true } } }, true],
    [{ event_name: "pull_request", event: { pull_request: { draft: false } } }, true],
    [{ event_name: "pull_request", event: { pull_request: { draft: true } } }, false],
  ]) {
    for (const key of [BUILDER, ...SHARDS]) {
      assert.equal(runInNewContext(workflow.jobs[key].if, { github }), expected, `${key} ${JSON.stringify(github)}`);
    }
  }
});

test("only the one build saves the rebuilt cache under the restore primary key, after a successful build", () => {
  for (const key of SHARDS) {
    assert.ok(!workflow.jobs[key].steps.some(step => step.uses?.startsWith("actions/cache/save@")), key);
  }
  assert.equal(save.uses, restore.uses.replace("/restore@", "/save@"));
  assert.equal(save.with.path, ".next/cache");
  assert.equal(save.with.key, "${{ steps.restore-nextjs-cache.outputs.cache-primary-key }}");
  assert.ok(steps.indexOf(build) < steps.indexOf(save));
  assert.ok(steps.indexOf(save) < steps.findIndex(step => step.name === "Package the one build"));
  assert.doesNotMatch(save.if, /always\(|failure\(|continue-on-error/);
  assert.notEqual(build["continue-on-error"], true);
});

test("the one build is published before any page check runs, for the shards and the visual comparison", () => {
  const pack = steps.find(step => step.name === "Package the one build");
  const upload = steps.find(step => step.name === "Upload the one build");
  assert.equal(pack.run, "tar --exclude='.next/cache' -czf \"$RUNNER_TEMP/app-build.tgz\" .next");
  assert.equal(upload.with.name, "app-build");
  assert.equal(upload.with.path, "${{ runner.temp }}/app-build.tgz");
  assert.equal(upload.with["retention-days"], 1);
  assert.ok(steps.indexOf(build) < steps.indexOf(pack));
  for (const key of SHARDS) {
    const shardSteps = workflow.jobs[key].steps;
    const download = shardSteps.find(step => step.name === "Download the one build");
    assert.equal(download.with.name, "app-build", key);
    assert.ok(shardSteps.indexOf(download) < shardSteps.findIndex(step => step.id === "smoke"), key);
  }
});

test("only production pushes refresh the cache; PRs and exact-key reruns never save", () => {
  for (const event of ["pull_request", "push", "workflow_dispatch"]) {
    for (const ref of ["refs/heads/production", "refs/heads/feature", "refs/pull/123/merge"]) {
      for (const hit of ["true", "false", ""]) {
        const condition = save.if.replaceAll("steps.restore-nextjs-cache.outputs.cache-hit", JSON.stringify(hit));
        const actual = runInNewContext(condition, { github: { event_name: event, ref } });
        assert.equal(actual, event === "push" && ref === "refs/heads/production" && hit !== "true", `${event}/${ref}/${hit}`);
      }
    }
  }
});
