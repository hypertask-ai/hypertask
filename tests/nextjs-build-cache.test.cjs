const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const { runInNewContext } = require("node:vm");
const yaml = require("js-yaml");

const workflow = yaml.load(readFileSync(".github/workflows/ci-tests.yml", "utf8"));
const steps = workflow.jobs["app-build"].steps;
const restore = steps.find(step => step.id === "restore-nextjs-cache");
const save = steps.find(step => step.name === "Save Next.js build cache");
const build = steps.find(step => step.name === "Build the app once");
const smoke = workflow.jobs["browser-smoke"].steps;

test("the one build job restores only the matching Next.js incremental cache before building", () => {
  const cacheSha = readFileSync(".github/actions/action-archive-cache-manifest.txt", "utf8")
    .match(/^actions\/cache ([a-f0-9]{40}) /m)[1];
  assert.equal(restore.uses, `actions/cache/restore@${cacheSha}`);
  assert.equal(restore.with.path, ".next/cache");
  assert.equal(restore.if, build.if);
  assert.ok(steps.indexOf(restore) < steps.indexOf(build));
  assert.equal(restore.with.key, "nextjs-${{ runner.os }}-${{ hashFiles('package-lock.json', 'next.config.*') }}-${{ github.sha }}");
  assert.equal(restore.with["restore-keys"].trim(), restore.with.key.replace("${{ github.sha }}", ""));
  assert.equal(workflow.on.push.branches.includes("production"), true);
});

test("browser-smoke runs on pushes and on ready pull requests, never on drafts or a cancelled build", () => {
  const reads = (github, result = "success") => runInNewContext(workflow.jobs["browser-smoke"].if, {
    github,
    needs: { "app-build": { result } },
    cancelled: () => false,
  });
  for (const [github, expected] of [
    [{ event_name: "push" }, true],
    [{ event_name: "push", event: {} }, true],
    [{ event_name: "push", event: { pull_request: { draft: true } } }, true],
    [{ event_name: "pull_request", event: { pull_request: { draft: false } } }, true],
    [{ event_name: "pull_request", event: { pull_request: { draft: true } } }, false],
  ]) {
    assert.equal(reads(github), expected, JSON.stringify(github));
  }
  // The required context reports the build's failure; it must never skip.
  assert.equal(reads({ event_name: "pull_request", event: { pull_request: { draft: false } } }, "failure"), true);
  assert.equal(reads({ event_name: "pull_request", event: { pull_request: { draft: false } } }, "cancelled"), false);
});

test("the one build saves its cache under the restore primary key, only after a successful build", () => {
  assert.equal(save.uses, restore.uses.replace("/restore@", "/save@"));
  assert.equal(save.with.path, ".next/cache");
  assert.equal(save.with.key, "${{ steps.restore-nextjs-cache.outputs.cache-primary-key }}");
  assert.ok(steps.indexOf(build) < steps.indexOf(save));
  assert.doesNotMatch(save.if, /always\(|failure\(|continue-on-error/);
  assert.notEqual(build["continue-on-error"], true);
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

test("the required browser-smoke context never runs next build and downloads the one build", () => {
  const runs = smoke.filter(step => typeof step.run === "string").map(step => step.run).join("\n");
  assert.doesNotMatch(runs, /next build/);
  assert.equal(workflow.jobs["browser-smoke"].needs.length, 1);
  assert.equal(workflow.jobs["browser-smoke"].needs[0], "app-build");
  const download = smoke.find(step => step.name === "Download the one build");
  assert.equal(download.with.name, "app-build");
  assert.equal(download.with.path, "${{ runner.temp }}/app-build");
  const unpack = smoke.find(step => step.name === "Unpack the one build");
  assert.equal(unpack.run, 'tar -xzf "$RUNNER_TEMP/app-build/app-build.tgz" -C "$GITHUB_WORKSPACE"');
  assert.ok(smoke.findIndex(step => step.name === "Require the one build") < smoke.indexOf(download));
  assert.equal(smoke.find(step => step.name === "Require the one build").env.APP_BUILD_RESULT, "${{ needs.app-build.result }}");
});

test("the artifact leaves the incremental cache behind and lives only one day", () => {
  const pack = steps.find(step => step.name === "Package the one build");
  const upload = steps.find(step => step.name === "Upload the one build");
  assert.equal(pack.run, "tar --exclude='.next/cache' -czf \"$RUNNER_TEMP/app-build.tgz\" .next");
  assert.equal(upload.with.name, "app-build");
  assert.equal(upload.with.path, "${{ runner.temp }}/app-build.tgz");
  assert.equal(upload.with["retention-days"], 1);
});
