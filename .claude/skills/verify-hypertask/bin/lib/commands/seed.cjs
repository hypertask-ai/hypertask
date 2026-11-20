const { rmSync } = require("node:fs");
const path = require("node:path");
const { dryRun, ensureRunDir, fail, localEnv, localSecrets, parseArgs, readJson, repoRoot, run, runDir, stateFile } = require("../context.cjs");

const usage = `ht-verify seed - seed the disposable local database and write a signed-in state

Usage:
  ht-verify seed [--visual] [--all-flags-on] [--dry-run]

  --visual        Full-page visual fixture: fixed clock, board and task screens.
  --all-flags-on  Turn every flag on for the seeded account.
  --dry-run       Print the environment and the command, write nothing.

Wraps scripts/seed-browser-smoke.mjs, the seeding CI already trusts. It refuses a
non-loopback DATABASE_URL, so it can never write production. The state goes to
the run folder browser/state.json with the fixture next to it, then the identity
is checked. Needs ht-verify up first. It replaces the whole browser/ folder, so
an older seeded state never collides; for a clean database run ht-verify down.

Examples:
  ht-verify up && ht-verify seed && ht-verify login
  ht-verify seed --visual
  ht-verify seed --dry-run`;

module.exports = {
  name: "seed",
  summary: "seed the disposable local database and write a signed-in state",
  usage,
  async run(argv) {
    const { values } = parseArgs(argv, { visual: "bool", "all-flags-on": "bool", "dry-run": "bool" });
    ensureRunDir();
    const env = localEnv();
    const databaseUrl = process.env.DATABASE_URL || env.databaseUrl || "";
    const state = stateFile();
    const output = path.join(runDir(), "seed.out");
    const script = path.join(repoRoot, "scripts/seed-browser-smoke.mjs");
    const extra = [values.visual && "--visual", values["all-flags-on"] && "--all-flags-on"].filter(Boolean);
    const seedEnv = { BROWSER_SMOKE_STATE_FILE: state, GITHUB_OUTPUT: output, DATABASE_URL: databaseUrl, ...localSecrets };
    const plan = [`env BROWSER_SMOKE_STATE_FILE=${state} GITHUB_OUTPUT=${output} DATABASE_URL=${databaseUrl || "<from ht-verify up>"} node ${script} ${extra.join(" ")}`.trim()];
    if (values["dry-run"]) return { target: "local", data: dryRun("seed", plan).data };
    if (!databaseUrl) fail("no DATABASE_URL", "Run ht-verify up first, or export DATABASE_URL for a loopback database.", "usage", 2);
    let host = "";
    try {
      host = new URL(databaseUrl).hostname;
    } catch {
      fail(`DATABASE_URL is not a URL: ${databaseUrl.replace(/:[^:@/]+@/, ":***@")}`, "Run ht-verify up and read databaseUrl from the run folder env.json.", "usage", 2);
    }
    if (!["127.0.0.1", "localhost"].includes(host)) {
      fail(`seed refuses a non-loopback database host: ${host}`, "Seed only the database ht-verify up created; never production or a shared branch database.", "refused", 2);
    }
    rmSync(path.dirname(state), { recursive: true, force: true });
    const result = run("node", [script, ...extra], { env: seedEnv, timeout: 300_000 });
    if (result.status !== 0) {
      fail(`seeding failed: ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400)}`, "Fix the error above, then ht-verify seed again; make sure ht-verify up is still running.", "failed");
    }
    const fixture = readJson(path.join(path.dirname(state), "card-fixture.json"), {});
    const boardId = /^\/detail\/project-(\d+)\//.exec(fixture.detailPath || "")?.[1];
    const boardPath = fixture.boardPath || (boardId ? `/project?id=${boardId}&surface=board` : null);
    const base = env.baseUrl || `http://127.0.0.1:${env.port || 3000}`;
    const identity = run(path.join(repoRoot, ".claude/skills/verify-qa/scripts/qa-identity"), [state, "--base-url", new URL(base).origin], { timeout: 30_000 });
    const identityLine = (identity.stdout || identity.stderr).trim().split("\n").pop();
    if (identity.status !== 0) {
      fail(`seeded state does not load: ${identityLine}`, "Run ht-verify up, then ht-verify seed again; do not reuse a production state here.", "not-ready");
    }
    return {
      target: "local",
      data: {
        stateFile: state,
        fixture: { boardPath, detailPath: fixture.detailPath || null },
        identity: identityLine,
        log: output,
      },
      evidence: [path.join(path.dirname(state), "card-fixture.json")],
    };
  },
};
