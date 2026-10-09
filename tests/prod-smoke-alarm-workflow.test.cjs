const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const yaml = require("js-yaml");
const vm = require("node:vm");

test("smoke classification routes unrunnable checks to infra and confirmed failures to live alerts without invoking rollback", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const start = workflow.indexOf("      - name: Classify and report a failed smoke check");
  const runStart = workflow.indexOf("        run: |\n", start) + "        run: |\n".length;
  const runEnd = workflow.indexOf("      - name: Update the consecutive smoke alarm", runStart);
  assert.ok(start !== -1 && runStart > start && runEnd > runStart);
  const template = workflow.slice(runStart, runEnd).split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n")
    .replaceAll("${{ github.repository }}", "hypertask-ai/hypertask");

  for (const event of ["push", "workflow_dispatch"]) {
    for (const [preflight, applicationFailure, expected] of [
      [{ ok: true }, true, /confirmed an application failure; waiting for consecutive smoke alarm/],
      [{ ok: false, reason: "expired session" }, false, /Smoke QA unrunnable: expired session/],
      [{ ok: true }, false, /failed without a confirmed application-failure verdict/],
    ]) {
      const directory = await mkdtemp(join(tmpdir(), "smoke-alert-only-"));
      try {
        const bin = join(directory, "bin");
        const state = join(directory, "e2e/smoke/.state");
        await mkdir(bin);
        await mkdir(state, { recursive: true });
        await writeFile(join(state, "preflight.json"), JSON.stringify(preflight));
        if (applicationFailure) {
          await writeFile(join(state, "application-failure.json"), '{"view":"inbox"}');
        }
        await writeFile(join(bin, "node"), '#!/bin/sh\nprintf "%s\\n" "$*" > "$NODE_LOG"\n');
        await writeFile(join(bin, "curl"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CURL_LOG"\n');
        await chmod(join(bin, "node"), 0o755);
        await chmod(join(bin, "curl"), 0o755);
        const output = spawnSync("bash", ["-c", template.replaceAll("${{ github.event_name }}", event)], {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            CURL_LOG: join(directory, "requests"),
            NODE_LOG: join(directory, "node-invoked"),
            GITHUB_TOKEN: "stub-github",
            GITHUB_REPOSITORY: "hypertask-ai/hypertask",
            ROLLBACK_GITHUB_TOKEN: "stub-rollback",
            VERCEL_TOKEN: "stub-vercel",
            SHA: "a".repeat(40),
            TG_TOKEN: "stub",
            TG_CHAT: "stub",
            GITHUB_OUTPUT: join(directory, "outputs"),
          },
        });
        assert.equal(output.status, 1, output.stdout + output.stderr);
        assert.match(output.stdout, expected);
        const requests = await readFile(join(directory, "requests"), "utf8").catch(() => "");
        assert.equal(requests.split("\n").filter((line) => /https:\/\/api\.telegram\.org\//.test(line)).length, 0);
        assert.doesNotMatch(requests, /api\.vercel\.com|\/git\/|MERGE_FREEZE/);
        if (event === "push" && applicationFailure) {
          assert.match(requests, /prod-health-gate/);
          assert.match(requests, /Failed production smoke/);
        } else {
          assert.doesNotMatch(requests, /api\.github\.com/);
        }
        const report = await readFile(join(directory, "node-invoked"), "utf8");
        assert.match(report, applicationFailure ? /production-alert.mjs live smoke-failure/ : /production-alert.mjs setup smoke-(unrunnable|unconfirmed)/);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});

test("the rollback job runs only for confirmed production-push signals, even when monitoring failed", async () => {
  const workflow = yaml.load(await readFile(".github/workflows/prod-health.yml", "utf8"));
  const job = workflow.jobs.rollback;
  assert.deepEqual(job.needs, ["health", "smoke", "core-actions"]);
  assert.deepEqual(job.permissions, { contents: "read" });
  assert.equal(job.steps[0].with["persist-credentials"], false);
  const expression = job.if.slice(3, -2).replaceAll("needs.core-actions", 'needs["core-actions"]');
  for (const event of ["push", "schedule", "workflow_dispatch"]) {
    for (const signal of ["health", "smoke", "core-actions", "none"]) {
      for (const cancelled of [false, true]) {
        const needs = Object.fromEntries(job.needs.map((name) => [name, {
          result: name === signal ? "failure" : "skipped",
          outputs: { rollback: name === signal ? "true" : "" },
        }]));
        const enabled = vm.runInNewContext(expression, {
          github: { event_name: event }, needs, cancelled: () => cancelled,
        });
        assert.equal(enabled, event === "push" && signal !== "none" && !cancelled);
      }
    }
  }
});

test("rollback reports freeze, dropped commits and failures without hiding failed operations", async () => {
  const workflow = yaml.load(await readFile(".github/workflows/prod-health.yml", "utf8"));
  const script = workflow.jobs.rollback.steps.find((step) => step.run).run;
  for (const [result, status, expected] of [
    [{ action: "requested", freeze: true, revert: { status: "created", dropped: [{ sha: "abc", title: "bad release" }] } }, 0, /Dropped commits: abc bad release/],
    [{ action: "failed", freeze: true, revert: { status: "failed" }, errors: { revert: "HTTP 403" } }, 1, /Errors: revert: HTTP 403/],
    [{ action: "skip", freeze: true, reason: "MERGE_FREEZE is already set", revert: { status: "skipped" } }, 0, /MERGE_FREEZE is already set/],
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "guarded-rollback-workflow-"));
    try {
      const bin = join(directory, "bin");
      await mkdir(bin);
      await writeFile(join(bin, "node"), '#!/bin/sh\ncase "$1" in *emergency-rollback*) printf "%s\\n" "$ROLLBACK_RESULT" ;; *) printf "%s\\n" "$*" > "$ALERT_LOG" ;; esac\n');
      await writeFile(join(bin, "curl"), '#!/bin/sh\nprintf "%s\\n" "$*" > "$ALERT_LOG"\n');
      await chmod(join(bin, "node"), 0o755);
      await chmod(join(bin, "curl"), 0o755);
      const output = spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
        cwd: directory, encoding: "utf8",
        env: {
          ...process.env, PATH: `${bin}:${process.env.PATH}`,
          ROLLBACK_RESULT: JSON.stringify(result), ALERT_LOG: join(directory, "alert"),
          GITHUB_SHA: "a".repeat(40), TG_TOKEN: "stub", TG_CHAT: "stub", GITHUB_STEP_SUMMARY: join(directory, "summary"),
        },
      });
      assert.equal(output.status, status, output.stdout + output.stderr);
      const alert = await readFile(join(directory, result.action === "skip" ? "summary" : "alert"), "utf8");
      assert.match(alert, expected);
      assert.match(alert, /Freeze: set/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
