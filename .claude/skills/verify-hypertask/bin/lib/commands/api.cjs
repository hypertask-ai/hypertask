const { readFileSync } = require("node:fs");
const { fail, localEnv, parseArgs } = require("../context.cjs");
const { sessionState } = require("../session.cjs");

const usage = `ht-verify api <method> <path> - one authenticated request with the run's cookies

Usage:
  ht-verify api GET /api/projects/boardTasks [--data '<json>'] [--base URL] [--state PATH]
  ht-verify api POST /api/tasks/create --data '<json>' --confirm [--dry-run]

  <method>   GET (default when omitted), HEAD, POST, PUT, PATCH or DELETE.
  <path>     path on the base URL, or a full URL.
  --data     JSON request body.
  --base     base URL, default from the run folder env.json, else app.hypertask.ai.
  --state    auth state. Default: the run folder browser/state.json, else the QA
             flags state. Its cookies are sent and never printed.
  --confirm  required for a write, because a write reaches shared data.
  --dry-run  print the request shape and send nothing.

A write without --confirm is refused. The response body is returned as JSON up to
4000 characters. A 401 means the state expired, exit 3. A 403 is a permission,
flag or origin refusal from the route, reported with its body, exit 1, so a
refusal is never mistaken for an expired identity.

Examples:
  ht-verify api GET /api/flags
  ht-verify api POST /api/comments/create --data '{"taskId":1,"content":"hi"}' --confirm
  ht-verify api PATCH /api/tasks/single --data '{"id":1}' --confirm --dry-run`;

const WRITE = ["POST", "PUT", "PATCH", "DELETE"];
const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];

function cookieHeader(state) {
  const now = Date.now() / 1000;
  return state.cookies
    .filter((cookie) => typeof cookie?.name === "string" && typeof cookie?.value === "string")
    .filter((cookie) => cookie.expires === -1 || cookie.expires > now)
    .sort((left, right) => right.path.length - left.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

module.exports = {
  name: "api",
  summary: "one authenticated request with the run's cookies, writes behind --confirm",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { data: "value", base: "value", state: "value", confirm: "bool", "dry-run": "bool" });
    const [first, ...rest] = positionals;
    const named = METHODS.includes(String(first).toUpperCase());
    const method = named ? String(first).toUpperCase() : "GET";
    const target = named ? rest[0] : first;
    if (!target) fail("api needs a method and a path", "For example: ht-verify api GET /api/flags", "usage", 2);
    if (WRITE.includes(method) && !values.confirm) {
      fail(`${method} reaches shared data and needs --confirm`, `Re-run with --confirm, or add --dry-run to see the request without sending it.`, "refused", 2);
    }
    const base = values.base || localEnv().baseUrl || "https://app.hypertask.ai";
    const url = target.startsWith("/") ? new URL(target, base).toString() : target;
    const plan = { method, url, data: values.data ? JSON.parse(values.data) : null };
    if (values["dry-run"]) return { target: base.includes("127.0.0.1") ? "local" : "production", data: { dryRun: true, steps: [plan] } };
    const stateFile = values.state || sessionState();
    if (!stateFile) fail("no auth state to send", "Run ht-verify seed for a local run, or pass --state with a QA state file.", "usage", 2);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    const response = await fetch(url, {
      method,
      headers: { Cookie: cookieHeader(state), ...(values.data ? { "Content-Type": "application/json" } : {}) },
      body: values.data,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    }).catch((error) => fail(`request failed: ${error.message}`, "Check the base URL and that the server is up, then retry.", "unreadable", 2));
    const text = (await response.text()).slice(0, 4_000);
    if (response.status === 401) {
      fail(`identity expired: the server refused this state (401)`, "Refresh the state through verify-qa reference/logins.md, then retry.", "identity-expired", 3);
    }
    if (response.status === 403) {
      return {
        target: base.includes("127.0.0.1") ? "local" : "production",
        data: { method, url, status: 403, ok: false, body: text },
        ok: false,
        error: { code: "forbidden", message: "the route refused this request (403)", next: "Read the body: a flag, role, origin or scope refused it. That is not an expired identity." },
      };
    }
    return {
      target: base.includes("127.0.0.1") ? "local" : "production",
      data: { method, url, status: response.status, ok: response.ok, body: text },
      ok: response.ok,
      error: response.ok ? null : { code: "failed", message: `HTTP ${response.status}`, next: "Read the response body, fix the request, and retry." },
    };
  },
};
