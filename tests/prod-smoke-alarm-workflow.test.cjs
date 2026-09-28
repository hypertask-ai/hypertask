const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { chmod, mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

test("a failed smoke rollback alerts immediately even on the first red", async () => {
  const workflow = await readFile(".github/workflows/prod-health.yml", "utf8");
  const start = workflow.indexOf("      - name: Decide unrunnable vs. real failure, rollback if confirmed");
  const runStart = workflow.indexOf("        run: |\n", start) + "        run: |\n".length;
  const runEnd = workflow.indexOf("      - name: Update the consecutive smoke alarm", runStart);
  assert.ok(start !== -1 && runStart > start && runEnd > runStart);
  const script = workflow.slice(runStart, runEnd).split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n")
    .replaceAll("${{ github.event_name }}", "push")
    .replaceAll("${{ github.repository }}", "hypertask-ai/hypertask");

  for (const [result, alerts] of [
    [{ action: "requested", revert: { status: "created" }, promotion: { action: "requested" }, freeze: true }, 0],
    [{ action: "failed", revert: { status: "failed" }, promotion: { action: "failed" }, freeze: false }, 1],
    [{ action: "skip", revert: { status: "created" }, promotion: { action: "skip", reason: "no older READY deployment" }, freeze: true }, 1],
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "smoke-rollback-"));
    try {
      const bin = join(directory, "bin");
      const state = join(directory, "e2e/smoke/.state");
      await mkdir(bin);
      await mkdir(state, { recursive: true });
      await writeFile(join(state, "preflight.json"), '{"ok":true}');
      await writeFile(join(state, "application-failure.json"), '{"view":"inbox"}');
      await writeFile(join(bin, "node"), '#!/bin/sh\nprintf "%s\\n" "$ROLLBACK_RESULT"\n');
      await writeFile(join(bin, "curl"), '#!/bin/sh\nprintf "alert\\n" >> "$ALERT_LOG"\n');
      await chmod(join(bin, "node"), 0o755);
      await chmod(join(bin, "curl"), 0o755);
      const output = spawnSync("bash", ["-c", script], {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          ROLLBACK_RESULT: JSON.stringify(result),
          ALERT_LOG: join(directory, "alerts"),
          GITHUB_OUTPUT: join(directory, "output"),
          GITHUB_TOKEN: "",
          SHA: "a".repeat(40),
          TG_TOKEN: "stub",
          TG_CHAT: "stub",
        },
      });
      assert.equal(output.status, 1, output.stdout + output.stderr);
      const sent = await readFile(join(directory, "alerts"), "utf8").catch(() => "");
      assert.equal(sent.trim().split("\n").filter(Boolean).length, alerts, output.stdout + output.stderr);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
