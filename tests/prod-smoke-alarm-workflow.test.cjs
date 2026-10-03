const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

test("every failed smoke classification alerts immediately without invoking rollback", async () => {
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
      [{ ok: true }, true, /confirmed an application failure; automatic rollback is disabled/],
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
        await writeFile(join(bin, "node"), '#!/bin/sh\nprintf "invoked\\n" > "$NODE_LOG"\nexit 99\n');
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
          },
        });
        assert.equal(output.status, 1, output.stdout + output.stderr);
        assert.match(output.stdout, expected);
        const requests = await readFile(join(directory, "requests"), "utf8");
        assert.equal(requests.split("\n").filter((line) => /https:\/\/api\.telegram\.org\//.test(line)).length, 1);
        assert.doesNotMatch(requests, /api\.vercel\.com|\/git\/|MERGE_FREEZE/);
        if (event === "push" && applicationFailure) {
          assert.match(requests, /prod-health-gate/);
          assert.match(requests, /Failed production smoke \(alert only\)/);
        } else {
          assert.doesNotMatch(requests, /api\.github\.com/);
        }
        await assert.rejects(readFile(join(directory, "node-invoked")), { code: "ENOENT" });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});
