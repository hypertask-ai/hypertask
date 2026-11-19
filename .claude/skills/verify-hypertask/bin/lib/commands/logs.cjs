const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { fail, parseArgs, runDir } = require("../context.cjs");

const usage = `ht-verify logs - read the run's dev or browser log

Usage:
  ht-verify logs [--dev|--browser] [--lines 50] [--grep TEXT]

  --dev       the Next dev server log (default).
  --browser   the persistent session's console, page errors and failed requests.
  --lines     how many trailing lines. Default 50, maximum 500.
  --grep      only lines containing this text.

Both files live in the run folder: dev.log and session/console.log. Read-only.

Examples:
  ht-verify logs
  ht-verify logs --dev --grep error --lines 20
  ht-verify logs --browser --lines 100`;

module.exports = {
  name: "logs",
  summary: "read the run's dev or browser log",
  usage,
  async run(argv) {
    const { values } = parseArgs(argv, { dev: "bool", browser: "bool", lines: "value", grep: "value" });
    if (values.dev && values.browser) fail("pick one log", "Pass --dev or --browser, not both.", "usage", 2);
    const lines = Number(values.lines ?? 50);
    if (!Number.isInteger(lines) || lines < 1 || lines > 500) fail(`invalid --lines ${values.lines}`, "Pass a line count between 1 and 500.", "usage", 2);
    const file = values.browser ? path.join(runDir(), "session/console.log") : path.join(runDir(), "dev.log");
    if (!existsSync(file)) fail(`no log at ${file}`, values.browser ? "Run ht-verify session start first." : "Run ht-verify up first.", "not-ready");
    const selected = readFileSync(file, "utf8").split("\n").filter((line) => !values.grep || line.includes(values.grep));
    return { target: null, data: { file, matched: selected.length, lines: selected.slice(-lines) } };
  },
};
