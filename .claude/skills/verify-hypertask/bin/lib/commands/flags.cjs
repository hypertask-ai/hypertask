const path = require("node:path");
const { fail, parseArgs, repoRoot, run } = require("../context.cjs");

const usage = `ht-verify flags - read a flag, or switch one through the approved path

Usage:
  ht-verify flags list [--base URL]
  ht-verify flags show <key> [--base URL]
  ht-verify flags set <key> <off|owner-qa|everyone|only-me> --reason <comment-url> [--confirm] [--dry-run]

  list          every flag and its state, read-only.
  show          one flag's state, read-only.
  set           wraps ht-flag set, which enforces the approval rules: the reason
                must link to a clear yes from Valentin within 7 days. A switch
                needs --confirm; without it you get the request preview.

NEVER switch a flag Off: Off is Valentin's own safety switch. A flagged failure is
held at owner-qa with --failure, not turned off.

Examples:
  ht-verify flags list
  ht-verify flags show htpr-8054-graphite-2
  ht-verify flags set htpr-9471-example owner-qa --failure "broken on phone" --confirm`;

function htFlag(args, base) {
  const result = run(path.join(repoRoot, ".claude/skills/ship/scripts/ht-flag"), args, { timeout: 60_000, env: base ? { HT_BASE_URL: base } : {} });
  if (result.status !== 0) {
    fail((result.stderr || result.stdout).trim().split("\n").pop() || `ht-flag exited ${result.status}`, "Read ht-flag's message; the approval rules live in ship/SKILL.md.", "failed", 2);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { raw: result.stdout.trim() };
  }
}

module.exports = {
  name: "flags",
  summary: "read a flag, or switch one through the approved path",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { base: "value", reason: "value", failure: "value", confirm: "bool", "dry-run": "bool" });
    const [action, key, mode] = positionals;
    if (action === "list") return { target: "production", data: { flags: htFlag(["get"], values.base) } };
    if (action === "show") {
      if (!key) fail("flags show needs a key", "For example: ht-verify flags show htpr-8054-graphite-2", "usage", 2);
      return { target: "production", data: { key, flag: htFlag(["get", key], values.base) } };
    }
    if (action !== "set") fail(`unknown flags action ${action}`, "Pass list, show or set.", "usage", 2);
    if (!key || !mode) fail("flags set needs a key and a mode", "For example: ht-verify flags set <key> owner-qa --failure \"reason\" --confirm", "usage", 2);
    if (mode === "off" || mode === "OFF") fail("refusing to switch a flag Off", "Off is Valentin's safety switch. Use owner-qa to hold a broken flag.", "refused", 2);
    if (!values.reason && !values.failure) fail("a switch needs --reason or --failure", "Link the approval comment with --reason, or hold a broken flag with --failure.", "usage", 2);
    const args = values.failure ? ["set", key, mode, "--failure", values.failure] : ["set", key, mode, "--reason", values.reason];
    if (values["dry-run"] || !values.confirm) {
      const preview = htFlag([...args, "--dry-run"], values.base);
      return { target: "production", data: { dryRun: true, confirmed: Boolean(values.confirm), request: preview, steps: [`ht-flag ${args.join(" ")}`] } };
    }
    return { target: "production", data: { switched: htFlag(args, values.base) } };
  },
};
