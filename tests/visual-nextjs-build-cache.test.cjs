const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runInNewContext } = require("node:vm");
const yaml = require("js-yaml");

const load = file => yaml.load(readFileSync(file, "utf8"));
const steps = load(".github/workflows/visual-regression.yml").jobs["visual-regression"].steps;
const smoke = load(".github/workflows/ci-tests.yml").jobs["browser-build"].steps;
const producer = smoke.find(step => step.name === "Save Next.js build cache");

for (const phase of ["base", "head"]) {
  test(`${phase} restores the compatible production browser-smoke cache before its build`, () => {
    const restore = steps.find(step => step.id === `restore-${phase}-nextjs-cache`);
    const stage = steps.find(step => step.name === `Stage ${phase} Next.js build cache`);
    assert.ok(restore);
    assert.ok(stage);
    assert.equal(restore.uses, producer.uses.replace("/save@", "/restore@"));
    assert.equal(restore.with.path, ".next/cache");
    assert.equal(restore.with.key, `nextjs-\${{ runner.os }}-\${{ hashFiles('${phase}/package-lock.json', '${phase}/next.config.*') }}-\${{ steps.baseline.outputs.${phase === "base" ? "sha" : "head"} }}`);
    assert.equal(restore.with["restore-keys"].trim(), restore.with.key.replace(/\$\{\{ steps\.baseline\.outputs\.(?:sha|head) \}\}$/, ""));
    assert.equal(stage.if, restore.if);
    assert.ok(steps.indexOf(restore) < steps.indexOf(stage));
    assert.ok(steps.indexOf(stage) < steps.findIndex(step => step.name === "Build and capture base, then compare head"));
    assert.match(steps.find(step => step.id === "baseline").run, /git -C head rev-parse HEAD/);
  });

  test(`${phase} staging moves only incremental cache, handles cold misses, and leaves no cross-checkout residue`, () => {
    const stage = steps.find(step => step.name === `Stage ${phase} Next.js build cache`);
    assert.ok(stage);
    for (const hit of [false, true]) {
      const root = mkdtempSync(path.join(os.tmpdir(), "visual-next-cache-"));
      try {
        mkdirSync(path.join(root, ".next"));
        writeFileSync(path.join(root, ".next", "BUILD_ID"), "must-not-move");
        if (hit) {
          mkdirSync(path.join(root, ".next", "cache", "webpack"), { recursive: true });
          writeFileSync(path.join(root, ".next", "cache", "webpack", "pack"), phase);
        }
        execFileSync("bash", ["-e", "-c", stage.run], { cwd: root });
        assert.equal(existsSync(path.join(root, ".next", "cache")), false);
        assert.equal(readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8"), "must-not-move");
        assert.equal(existsSync(path.join(root, phase, ".next", "BUILD_ID")), false);
        assert.equal(existsSync(path.join(root, phase, ".next", "cache")), hit);
        if (hit) assert.equal(readFileSync(path.join(root, phase, ".next", "cache", "webpack", "pack"), "utf8"), phase);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
}

test("base and head use separate restores; cached screenshots and production-only runs avoid unused restores", () => {
  const base = steps.find(step => step.id === "restore-base-nextjs-cache");
  const head = steps.find(step => step.id === "restore-head-nextjs-cache");
  assert.ok(base);
  assert.ok(head);
  assert.ok(steps.findIndex(step => step.name === "Stage base Next.js build cache") < steps.indexOf(head));
  for (const hit of ["true", "false", ""]) {
    assert.equal(runInNewContext(base.if.replaceAll("steps.baseline-cache.outputs.cache-hit", JSON.stringify(hit))), hit !== "true");
  }
  for (const event of ["push", "pull_request", "workflow_dispatch"]) {
    assert.equal(runInNewContext(head.if, { github: { event_name: event } }), event !== "push");
  }
});

test("the pull-request comparison reuses the one build instead of building the head", () => {
  const compare = load(".github/workflows/ci-tests.yml").jobs["visual-compare"];
  const runs = compare.steps.filter(step => typeof step.run === "string").map(step => step.run).join("\n");
  assert.doesNotMatch(runs, /next build/);
  assert.deepEqual(compare.needs, ["browser-build"]);
  assert.equal(compare.steps.find(step => step.name === "Download the one build").with.name, "app-build");
  assert.equal(compare.steps.find(step => step.name === "Give the head the one build").run,
    'mkdir -p "$RUNNER_TEMP/app-build/unpacked"\n' +
    'tar -xzf "$RUNNER_TEMP/app-build/app-build.tgz" -C "$RUNNER_TEMP/app-build/unpacked"\n' +
    'mv "$RUNNER_TEMP/app-build/unpacked/.next" head/.next\n');
  for (const name of ["Build and capture base, then compare head", "Summarize failed screens"]) {
    assert.equal(compare.steps.find(step => step.name === name).env.VISUAL_HEAD_BUILD, "artifact", name);
  }
  assert.equal(compare.steps.find(step => step.name === "Build and capture base, then compare head").env.VISUAL_BASE_ONLY, "false");
  const baseline = compare.steps.find(step => step.id === "baseline-cache");
  assert.equal(baseline.with.key, steps.find(step => step.id === "baseline-cache").with.key);
  assert.equal(baseline.with["restore-keys"], undefined);
  assert.equal(compare.steps.find(step => step.id === "restore-head-nextjs-cache"), undefined);
  assert.equal(compare.steps.filter(step => step.uses?.startsWith("actions/checkout@") && step.with["persist-credentials"] === false).length, 2);
  assert.equal(compare.steps.filter(step => step.uses?.startsWith("actions/cache/save@")).length, 0);
});

test("visual runs never write shared Next.js caches; only successful production smoke builds publish them", () => {
  assert.equal(steps.filter(step => step.uses?.startsWith("actions/cache/save@") && step.with.path.includes(".next")).length, 0);
  for (const event of ["push", "pull_request", "workflow_dispatch"]) {
    for (const ref of ["refs/heads/production", "refs/heads/feature", "refs/pull/123/merge"]) {
      const condition = producer.if.replaceAll("steps.restore-nextjs-cache.outputs.cache-hit", '"false"');
      assert.equal(runInNewContext(condition, { github: { event_name: event, ref } }), event === "push" && ref === "refs/heads/production");
    }
  }
  assert.doesNotMatch(producer.if, /always\(|failure\(/);
});
