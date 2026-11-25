const { existsSync } = require("node:fs");
const path = require("node:path");
const { dryRun, fail, localEnv, parseArgs, repoRoot, run, stateFile } = require("../context.cjs");
const { withPage } = require("../session.cjs");

const usage = `ht-verify shot <url> --out <absolute.png> - signed-in screenshot with a landing check

Usage:
  ht-verify shot <url> --out /abs/out.png [--state PATH | --account flags] [--viewport 390x844]
                       [--theme porcelain|graphite|graphite-2|amoled|dia] [--allow-redirect] [--dry-run]
  ht-verify shot --session --out /abs/out.png

  <url>             full URL, scheme included. Local runs use the env.json base URL.
  --out             absolute PNG path. Relative paths are refused.
  --state           auth state. Default: the run folder browser/state.json for a
                    loopback URL, otherwise the qa-login account's own file.
  --account         QA account for a production shot. Default flags (user 985).
  --viewport        default 390x844 (phone). 800+ width switches to a desktop agent.
  --theme           set the theme cookie before load.
  --allow-redirect  accept a redirect away from the requested path, labelled UNVERIFIED.
  --dry-run         print the exact helper command and take no shot.
  --session         shoot the persistent session's page instead of a new browser.

Wraps .claude/skills/verify-hypertask/scripts/phone-shot.sh, which refuses a login
landing and a missing state. A redirect away from the requested path is a failure
unless --allow-redirect. The PNG is the only evidence.

Examples:
  ht-verify shot http://127.0.0.1:3000/project?id=7049 --out /tmp/board.png
  ht-verify shot https://app.hypertask.ai/my-tasks --out /tmp/me.png --viewport 1440x900
  ht-verify shot https://app.hypertask.ai/my-tasks --out /tmp/me.png --account plain
  ht-verify shot http://127.0.0.1:3000/login --out /tmp/login.png --dry-run`;

function isLoopback(url) {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function parsedField(stdout, label) {
  const line = stdout.split("\n").find((entry) => entry.trim().startsWith(`${label}:`));
  return line ? line.split(":").slice(1).join(":").trim() : null;
}

module.exports = {
  name: "shot",
  summary: "signed-in screenshot with a login and redirect landing check",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { out: "value", state: "value", account: "value", viewport: "value", theme: "value", session: "bool", "allow-redirect": "bool", "dry-run": "bool" });
    const url = positionals[0];
    if (!values.session && !url) fail("shot needs a URL", "Pass the page to shoot, for example ht-verify shot http://127.0.0.1:3000/project?id=7049 --out /tmp/board.png.", "usage", 2);
    if (url && !/^https?:\/\//.test(url) && !values.session) fail(`no scheme in ${url}`, "Pass the full URL, scheme included, for example https://app.hypertask.ai/my-tasks.", "usage", 2);
    if (!values.out) fail("shot needs --out", "Pass an absolute PNG path, for example --out /tmp/board.png.", "usage", 2);
    if (!path.isAbsolute(values.out)) fail(`--out must be absolute, got ${values.out}`, "Prefix it with $PWD, for example --out \"$PWD/board.png\".", "usage", 2);
    if (values.session) {
      return withPage(async (page, session) => {
        await page.screenshot({ path: values.out, type: "png" });
        return { target: session.base.includes("127.0.0.1") ? "local" : "production", data: { file: values.out, url: page.url(), viewport: `${session.viewport.width}x${session.viewport.height}`, verified: true, session: true }, evidence: [values.out] };
      });
    }
    const runState = stateFile();
    let state = values.state;
    if (!state) {
      if (isLoopback(url) && existsSync(runState)) state = runState;
      else {
        const account = values.account || "flags";
        const selected = run(path.join(repoRoot, ".claude/skills/verify-hypertask/scripts/qa-login"), [account, "--state"], { timeout: 15_000 });
        if (selected.status !== 0) fail(`unknown account ${account}`, "Pass --account with one of the qa-login names, or --state with a state file.", "usage", 2);
        state = selected.stdout.trim();
      }
    }
    const helper = path.join(repoRoot, ".claude/skills/verify-hypertask/scripts/phone-shot.sh");
    const args = [url, values.out, "--state", state];
    if (values.viewport) args.push("--viewport", values.viewport);
    if (values.theme) args.push("--theme", values.theme);
    if (values["allow-redirect"]) args.push("--allow-redirect");
    if (values["dry-run"]) {
      const plan = [`.claude/skills/verify-hypertask/scripts/phone-shot.sh ${args.join(" ")}`];
      const local = localEnv();
      return { target: isLoopback(url) ? "local" : "production", data: dryRun("shot", plan, { out: values.out, state, url, baseUrl: local.baseUrl || null }).data };
    }
    const shot = run(helper, args, { timeout: 180_000 });
    if (shot.status !== 0) {
      fail((shot.stderr || shot.stdout).trim().split("\n").slice(-2).join(" ") || `phone-shot exited ${shot.status}`, "Read the error above; a login landing means fix the state, not the shot.", "failed");
    }
    const status = parsedField(shot.stdout, "status");
    return {
      target: isLoopback(url) ? "local" : "production",
      data: {
        file: values.out,
        url,
        landedOn: parsedField(shot.stdout, "url"),
        viewport: parsedField(shot.stdout, "viewport"),
        verified: !String(status).startsWith("UNVERIFIED"),
        bytes: Number(parsedField(shot.stdout, "file")?.replace(/.*\(([0-9]+) bytes\)/, "$1")) || null,
      },
      evidence: [values.out],
    };
  },
};
