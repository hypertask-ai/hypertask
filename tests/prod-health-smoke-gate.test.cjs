// HYCI-83 — the browser smoke job starts with the push and waits for the
// production health verdict instead of sitting behind `needs: health`.
// These tests read the workflow, then run the wait step's real bash against a
// stub `curl` so the release gate is exercised rather than pattern-matched.

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const yaml = require("js-yaml");

const workflow = yaml.load(readFileSync(".github/workflows/prod-health.yml", "utf8"));

function smokeStep(id) {
  const step = workflow.jobs.smoke.steps.find((item) => item.id === id);
  assert.ok(step, `smoke step ${id} not found`);
  return step;
}

test("smoke starts with the push, after its deploy-independent setup", () => {
  assert.equal(workflow.jobs.smoke.needs, undefined);
  const names = workflow.jobs.smoke.steps.map((step) => step.id || step.name);
  const npm = names.indexOf("setup-npm");
  const gate = workflow.jobs.smoke.steps.findIndex((step) => step.id === "gate");
  const run = names.indexOf("smoke");
  assert.ok(npm !== -1 && gate !== -1 && run !== -1);
  // npm ci and Chromium must be installed before the wait, so that work
  // overlaps the Vercel build instead of following it.
  assert.ok(npm < gate && gate < run, `unexpected step order: ${names.join(", ")}`);
});

test("the browser checks still need the health verdict for this exact SHA", () => {
  assert.match(smokeStep("smoke").if, /steps\.gate\.outputs\.ok == 'true'/);
  assert.match(smokeStep("decide").if, /steps\.gate\.outputs\.ok == 'true'/);
  const run = smokeStep("gate").run;
  // The two facts the old `needs: health` gate carried: the health job
  // concluded, and it published its live verdict for this commit.
  assert.match(run, /\.name == "health"\]\[0\]\.conclusion/);
  assert.match(run, /\.context == "prod-health-gate"\]\[0\]\.state/);
  assert.match(run, /\[ "\$state" = "success" \]/);
  // Reading the job before the status is what makes a missed status impossible.
  assert.ok(run.indexOf('name == "health"') < run.indexOf('prod-health-gate'));
});

test("the wait step runs the browser checks only on a live, healthy verdict for this SHA", () => {
  const directory = mkdtempSync(join(tmpdir(), "prod-health-gate-"));
  try {
    const bin = join(directory, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "curl"), [
      "#!/usr/bin/env bash",
      "set -u",
      'url="${!#}"',
      'case "$url" in',
      '  *"/jobs"*) printf "%s" "$JOBS_JSON" ;;',
      '  *"/statuses"*) printf "%s" "$STATUSES_JSON" ;;',
      '  *) printf "{}" ;;',
      "esac",
      "",
    ].join("\n"), { mode: 0o755 });
    chmod(join(bin, "curl"), 0o755);

    const cases = [
      {
        name: "health success and its live verdict",
        event: "push",
        jobs: '{"jobs":[{"name":"health","conclusion":"success"}]}',
        statusesRaw: '[{"context":"prod-health-gate","state":"success"}]',
        expectOk: true,
        expectOutput: /live and healthy; running the browser checks/,
      },
      {
        name: "health job failed",
        event: "push",
        jobs: '{"jobs":[{"name":"health","conclusion":"failure"}]}',
        statusesRaw: "[]",
        expectOk: false,
        expectOutput: /ended 'failure'/,
      },
      {
        name: "health succeeded with nothing to check",
        event: "push",
        jobs: '{"jobs":[{"name":"health","conclusion":"success"}]}',
        statusesRaw: "[]",
        expectOk: false,
        expectOutput: /without a live verdict/,
      },
      {
        name: "a failed gate is not overridden by a success elsewhere",
        event: "push",
        jobs: '{"jobs":[{"name":"health","conclusion":"success"}]}',
        statusesRaw: '[{"context":"prod-health-gate","state":"failure"}]',
        expectOk: false,
        expectOutput: /without a live verdict/,
      },
      {
        name: "manual dispatch runs the checks with nothing to wait for",
        event: "workflow_dispatch",
        jobs: "{}",
        statusesRaw: "[]",
        expectOk: true,
        expectOutput: /Manual run/,
      },
    ];

    for (const item of cases) {
      const output = join(directory, `out-${item.name.replaceAll(" ", "-")}.txt`);
      const result = spawnSync("bash", ["-c", smokeStep("gate").run], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GITHUB_TOKEN: "stub",
          GITHUB_REPOSITORY: "hypertask-ai/hypertask",
          RUN_ID: "1",
          SHA: "a".repeat(40),
          EVENT_NAME: item.event,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: join(directory, "summary.txt"),
          JOBS_JSON: item.jobs,
          STATUSES_JSON: item.statusesRaw,
        },
      });
      const written = (() => {
        try {
          return readFileSync(output, "utf8");
        } catch {
          return "";
        }
      })();
      assert.equal(result.status, 0, `${item.name}: ${result.stdout}${result.stderr}`);
      assert.match(result.stdout, item.expectOutput, item.name);
      assert.equal(/^ok=true$/m.test(written), item.expectOk, `${item.name}: GITHUB_OUTPUT was ${JSON.stringify(written)}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
