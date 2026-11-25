const path = require("node:path");
const { fail, localEnv, parseArgs, repoRoot, run, stateFile } = require("../context.cjs");

const usage = `ht-verify login [account] - pick a QA identity and prove the state loads

Usage:
  ht-verify login [account] [--state PATH] [--expect ID] [--base-url URL] [--no-verify]

  account    flags (default, user 985, sees Owner + QA) | plain (2343, flag off) | free
             (3411) | byok (3412) | pro (3413) | owner (4036) | member (4037) | guest
  --state    use this auth state instead of the account's own file. For a local run
             pass the seeded $HT_VERIFY_RUN/browser/state.json plus --base-url.
  --expect   expected user id. Defaults to the account's id; omitted for --state.
  --base-url origin to verify against. Default: the run folder env.json base,
             else https://app.hypertask.ai. A base that is neither loopback
             nor app.hypertask.ai is refused rather than checked elsewhere.
  --no-verify  print the account without calling the server. Offline, no identity proof.

Wraps qa-login and qa-identity. It prints no credential and no cookie, only the
account, the user id and the state path. Exit 3 means the state expired and needs
the login refresh in verify-hypertask reference/logins.md; exit 1 means mismatch.

Examples:
  ht-verify login
  ht-verify login plain
  ht-verify login --state "$HT_VERIFY_RUN/browser/state.json" --base-url http://127.0.0.1:3000`;

module.exports = {
  name: "login",
  summary: "pick a QA identity and prove the state loads",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { state: "value", expect: "value", "base-url": "value", "no-verify": "bool" });
    const account = positionals[0] || "flags";
    const selected = run(path.join(repoRoot, ".claude/skills/verify-hypertask/scripts/qa-login"), [account], { timeout: 15_000 });
    if (selected.status !== 0) {
      fail(`unknown account ${account}`, "Run ht-verify login --help for the eight accounts qa-login accepts.", "usage", 2);
    }
    const parsed = JSON.parse(selected.stdout);
    const state = values.state || parsed.stateFile;
    const requested = values["base-url"] || process.env.HT_VERIFY_BASE || localEnv().baseUrl || "https://app.hypertask.ai";
    let origin;
    try {
      origin = new URL(requested).origin;
    } catch {
      fail(`base URL is not a URL: ${requested}`, "Pass --base-url http://127.0.0.1:3000 for a local run, or leave it out for the run folder's base.", "usage", 2);
    }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname);
    const production = origin === "https://app.hypertask.ai";
    const expect = values.expect ?? (values.state ? undefined : parsed.userId ? String(parsed.userId) : undefined);
    const data = {
      account: parsed.account,
      expectedUserId: expect ? Number(expect) : null,
      stateFile: state,
      refresh: parsed.refresh,
      baseUrl: origin,
      verified: false,
      userId: null,
      identity: null,
    };
    const target = loopback ? "local" : "production";
    if (values["no-verify"]) return { target, data };
    if (!state) fail("guest has no auth state to verify", "Use guest for logged-out paths; pick flags, plain, free, byok, pro, owner or member to verify a login.", "usage", 2);
    if (!loopback && !production) {
      fail(`identity can only be verified at https://app.hypertask.ai or a loopback origin, not ${origin}`, "Pass --base-url http://127.0.0.1:<port> for a local run, or leave it out for production.", "usage", 2);
    }
    const identity = run(
      path.join(repoRoot, ".claude/skills/verify-hypertask/scripts/qa-identity"),
      [state, ...(expect ? ["--expect", expect] : []), ...(loopback ? ["--base-url", origin] : [])],
      { timeout: 30_000 },
    );
    const line = (identity.stdout || identity.stderr).trim().split("\n").pop();
    data.identity = line;
    const match = /^identity ok: user (\d+)$/.exec(line);
    if (identity.status !== 0) {
      const expired = identity.status === 3;
      fail(line || "identity check failed", expired ? `Refresh this one state through the recipe in .claude/skills/verify-hypertask/reference/logins.md, then re-run.` : "Check the state path and the base URL, then re-run ht-verify login.", expired ? "identity-expired" : "failed", expired ? 3 : 1);
    }
    data.verified = true;
    data.userId = match ? Number(match[1]) : null;
    return { target, data };
  },
};
