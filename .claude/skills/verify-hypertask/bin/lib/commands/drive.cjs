const path = require("node:path");
const { fail, localEnv, parseArgs, readJson, repoRoot, run, runDir } = require("../context.cjs");

const usage = `ht-verify drive <area> [--base URL] [--state PATH] [--board ID] [--dir DIR] [--phone]

Usage:
  ht-verify drive board|task|comments|flags|ctrl-j|ai-chat [--base URL] [--state PATH] [--board ID] [--dir DIR]
  ht-verify drive inbox [--phone] [--dir DIR]

  board     columns render, the seeded card is visible, a drag survives reload
  task      title renders, a description and bold survive reload
  comments  a comment posts, survives reload, and is deleted again
  flags     flag states load, and a switch without an agent token is refused
  ctrl-j    Control+j opens the writer without submitting
  ai-chat   the AI chat panel opens and answers from the stub
  inbox     the production inbox cycle (inbox-cycle-live.mjs)

Wraps the hands-free drives in .claude/skills/verify-hypertask/scripts, which only run
against a disposable loopback stack. The inbox drive is the production cycle.
Reports each step as PASS or FAIL with the run folder that holds its screenshots.

Examples:
  ht-verify drive board --base http://127.0.0.1:3100 --state <state> --board 55
  ht-verify drive comments --base http://127.0.0.1:3100 --state <state> --board 55
  ht-verify drive inbox`;

const AREAS = {
  board: "board-drive-live.mjs",
  task: "task-drive-live.mjs",
  comments: "comments-drive-live.mjs",
  flags: "flags-drive-live.mjs",
  "ctrl-j": "ctrl-j-drive.mjs",
  "ai-chat": "ai-chat-drive.mjs",
  inbox: "inbox-cycle-live.mjs",
};

function parseSteps(stdout) {
  return stdout.split("\n").filter((line) => /^(PASS|FAIL):/.test(line)).map((line) => {
    const [verdict, ...rest] = line.split(":");
    return { pass: verdict === "PASS", detail: rest.join(":").trim() };
  });
}

module.exports = {
  name: "drive",
  summary: "run a hands-free drive area and report each step",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { base: "value", state: "value", board: "value", dir: "value", phone: "bool" });
    const area = positionals[0];
    if (!area) fail("drive needs an area", `Pass one of ${Object.keys(AREAS).join(", ")}. Run ht-verify drive --help for examples.`, "usage", 2);
    const script = AREAS[area];
    if (!script) fail(`unknown drive area ${area}`, `Pass one of ${Object.keys(AREAS).join(", ")}.`, "usage", 2);
    const dir = values.dir || path.join(runDir(), "drive", area);
    const args = [path.join(repoRoot, ".claude/skills/verify-hypertask/scripts", script), dir];
    if (area === "inbox") {
      if (values.phone) args.push("--phone");
    } else {
      args.push("--base", values.base || localEnv().baseUrl || "", "--state", values.state || path.join(runDir(), "browser/state.json"));
      if (values.board) args.push("--board", values.board);
    }
    const base = values.base || localEnv().baseUrl || "";
    if (area !== "inbox" && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
      fail(`drive ${area} refuses a non-loopback base: ${base || "none"}`, "Pass --base http://127.0.0.1:<port> for the disposable stack; these drives never touch production.", "refused", 2);
    }
    const result = run("node", args, { timeout: 600_000 });
    const recorded = readJson(path.join(dir, "result.json"), {});
    const steps = parseSteps(result.stdout).length ? parseSteps(result.stdout) : recorded.steps || [];
    const failed = steps.filter((step) => !step.pass);
    return {
      target: area === "inbox" ? "production" : "local",
      ok: result.status === 0,
      data: { area, dir, exit: result.status, steps, failed: failed.map((step) => step.detail) },
      evidence: [dir],
      error: result.status === 0 ? null : { code: "failed", message: `${area} FAIL: ${failed.map((step) => step.detail).join("; ") || (result.stderr || result.stdout).trim().split("\n").slice(-2).join(" ")}`, next: `Read ${dir} and the step above, fix the cause, then re-run ht-verify drive ${area}.` },
    };
  },
};
