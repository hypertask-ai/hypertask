const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const { runInNewContext } = require("node:vm");
const yaml = require("js-yaml");

const workflow = yaml.load(readFileSync(".github/workflows/ci-tests.yml", "utf8"));
const halves = ["browser-smoke-desktop", "browser-smoke-mobile"].map(key => workflow.jobs[key]);
const steps = workflow.jobs["browser-smoke-desktop"].steps;
const save = steps.find(step => step.name === "Save Next.js build cache");
const build = steps.find(step => step.name === "Build the local app (no migrations)");
const restore = steps.find(step => step.id === "restore-nextjs-cache");

test("browser-smoke restores only the matching Next.js incremental build cache before building", () => {
  const cacheSha = readFileSync(".github/actions/action-archive-cache-manifest.txt", "utf8")
    .match(/^actions\/cache ([a-f0-9]{40}) /m)[1];
  for (const half of halves) {
    const halfSteps = half.steps;
    const halfRestore = halfSteps.find(step => step.id === "restore-nextjs-cache");
    const halfBuild = halfSteps.find(step => step.name === "Build the local app (no migrations)");
    assert.equal(halfRestore.uses, `actions/cache/restore@${cacheSha}`);
    assert.equal(halfRestore.with.path, ".next/cache");
    assert.equal(halfRestore.if, halfBuild.if);
    assert.ok(halfSteps.indexOf(halfRestore) < halfSteps.indexOf(halfBuild));
    assert.equal(halfRestore.with.key, "nextjs-${{ runner.os }}-${{ hashFiles('package-lock.json', 'next.config.*') }}-${{ github.sha }}");
    assert.equal(halfRestore.with["restore-keys"].trim(), halfRestore.with.key.replace("${{ github.sha }}", ""));
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
    for (const key of ["browser-smoke-desktop", "browser-smoke-mobile"]) {
      assert.equal(runInNewContext(workflow.jobs[key].if, { github }), expected, `${key} ${JSON.stringify(github)}`);
    }
  }
});

test("only the desktop half saves the rebuilt cache under the restore primary key, after a successful build", () => {
  assert.ok(!workflow.jobs["browser-smoke-mobile"].steps.some(step => step.uses?.startsWith("actions/cache/save@")));
  assert.equal(save.uses, restore.uses.replace("/restore@", "/save@"));
  assert.equal(save.with.path, ".next/cache");
  assert.equal(save.with.key, "${{ steps.restore-nextjs-cache.outputs.cache-primary-key }}");
  assert.ok(steps.indexOf(build) < steps.indexOf(save));
  assert.ok(steps.indexOf(save) < steps.findIndex(step => step.id === "smoke"));
  assert.doesNotMatch(save.if, /always\(|failure\(|continue-on-error/);
  assert.notEqual(build["continue-on-error"], true);
});

test("the required browser-smoke context publishes the one build for the visual comparison", () => {
  const pack = steps.find(step => step.name === "Package the one build");
  const upload = steps.find(step => step.name === "Upload the one build");
  const smoke = steps.find(step => step.id === "smoke");
  assert.equal(pack.run, "tar --exclude='.next/cache' -czf \"$RUNNER_TEMP/app-build.tgz\" .next");
  assert.equal(upload.with.name, "app-build");
  assert.equal(upload.with.path, "${{ runner.temp }}/app-build.tgz");
  assert.equal(upload.with["retention-days"], 1);
  assert.ok(steps.indexOf(build) < steps.indexOf(pack));
  assert.ok(steps.indexOf(upload) < steps.indexOf(smoke), "the build must be published before the page checks, so a failing check still publishes it");
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
