const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

const script = pathToFileURL(join(process.cwd(), ".github/scripts/golden-paths.mjs")).href;
const KINDS = ["FIREBASE", "NO_FIREBASE"];
const cliStub = `#!/usr/bin/env node
(async () => {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  let path, method = 'POST', body;
  if (args[0] === 'comment') { path = '/mcp/comments'; body = { task_id: Number(args[2]), text: option('--text') }; }
  else if (args[1] === 'create') { path = '/mcp/tasks/create'; body = { project_id: Number(option('--project')), section_id: Number(option('--section')), title: option('--title'), description: option('--description') }; }
  else if (args[1] === 'get') { method = 'GET'; path = '/mcp/tasks?task_id=' + args[2]; }
  else if (args[1] === 'update') { path = '/mcp/tasks/update'; body = { task_id: Number(args[2]), status: option('--status') }; }
  else throw new Error('Unexpected CLI command');
  const response = await fetch(process.env.HYPERTASKS_API_URL + path, { method, headers: { Authorization: 'Bearer ' + process.env.HYPERTASKS_JWT_TOKEN, 'Content-Type': 'application/json', 'X-Monitor-Cli': 'true' }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + text);
  console.log(text);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
`;

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "golden-paths-test-"));
  const env = {
    HYPERTASK_HEALTH_FIREBASE_EMAIL: "health-firebase@example.test",
    HYPERTASK_HEALTH_NO_FIREBASE_EMAIL: "health-no-firebase@example.test",
    HYPERTASK_HEALTH_FIREBASE_MAIL_REFRESH_TOKEN: "firebase-mail-refresh-secret",
    HYPERTASK_HEALTH_NO_FIREBASE_MAIL_REFRESH_TOKEN: "no-firebase-mail-refresh-secret",
    HYPERTASK_HEALTH_MAIL_CLIENT_ID: "mail-client-id-secret",
    HYPERTASK_HEALTH_MAIL_CLIENT_SECRET: "mail-client-secret",
    HYPERTASK_HEALTH_PROJECT_ID: "71",
    TELEGRAM_BOT_TOKEN: "telegram-bot-secret",
    TELEGRAM_CHAT_ID: "telegram-chat-secret",
    GOLDEN_PATHS_STATE_FILE: join(directory, "heartbeat.json"),
    GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
  };
  const state = { tasks: [], alerts: [], requests: [], clients: new Map(), cleaned: [], signedOut: [], otpSent: {}, refreshes: 0, errors: [], nextId: 101 };
  const logs = [];
  let base;
  const json = (response, data, status = 200, headers = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify(data));
  };
  const suffix = (kind) => kind.toLowerCase().replaceAll("_", "-");
  const secretError = (response) => json(response, { error: "injected failure " + Object.values(env).join(" ") + " fresh-FIREBASE-token-secret 123456 consent-secret" }, 503);
  function operation(resource, action, input, source, response, kind) {
    if (source === "mcp" && resource === "tasks" && action === "get") assert(Array.isArray(input.task_id), "MCP get_tasks schema requires an array");
    const id = Number(Array.isArray(input.task_id) ? input.task_id[0] : input.task_id);
    let task = state.tasks.find((item) => item.id === id);
    if (resource === "tasks" && action === "create") {
      assert.equal(input.project_id, 71);
      task = { id: state.nextId++, title: input.title, description: input.description, projectId: 71, sectionId: Number(input.section_id), status: "Normal", comments: [] };
      state.tasks.push(task);
      if (options.lostReceipt === source) { secretError(response); return null; }
      return { success: true, task };
    }
    if (resource === "tasks" && action === "get") {
      assert(task, "Read unknown task");
      return { success: true, tasks: [{ ...task, ...(options.corrupt === source ? { title: "wrong" } : {}) }] };
    }
    if (resource === "comments" && action === "add") {
      assert(task, "Comment unknown task");
      if (options.fail === `${source}-ops${source === "mcp" ? `-${suffix(kind)}` : ""}`) { secretError(response); return null; }
      task.comments.push({ text: input.text });
      return { success: true, comment: { id: 201, text: input.text } };
    }
    if (resource === "comments" && action === "list") return { success: true, comments: task.comments };
    if (resource === "tasks" && action === "update") {
      assert(task, "Update unknown task");
      if (input.sectionId) task.sectionId = input.sectionId;
      if (input.section_id) task.sectionId = input.section_id;
      if (input.status) task.status = input.status;
      return { success: true, tasks: [task] };
    }
    throw new Error(`Unknown operation ${resource}/${action}`);
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, base);
      const path = url.pathname;
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = raw ? (request.headers["content-type"]?.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw)) : {};
      state.requests.push({ path, body, method: request.method, headers: request.headers, query: Object.fromEntries(url.searchParams) });
      const kind = request.headers.cookie?.includes("session-NO_FIREBASE-secret") || request.headers.authorization?.includes("NO_FIREBASE") ? "NO_FIREBASE" : "FIREBASE";
      const email = env[`HYPERTASK_HEALTH_${kind}_EMAIL`];
      const unauthenticated = !request.headers.authorization && !request.headers.cookie;
      if (path === "/.well-known/oauth-protected-resource") {
        if (options.fail === "mcp-discovery") return secretError(response);
        return json(response, { resource: `${base}/mcp`, authorization_servers: [base] });
      }
      if (path === "/.well-known/oauth-authorization-server") return json(response, { issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, registration_endpoint: `${base}/oauth/register`, code_challenge_methods_supported: ["S256"] });
      if (path === "/token") {
        const mailKind = body.refresh_token === env.HYPERTASK_HEALTH_NO_FIREBASE_MAIL_REFRESH_TOKEN ? "NO_FIREBASE" : "FIREBASE";
        return json(response, { access_token: `mail-${mailKind}-access-secret` });
      }
      if (path === "/gmail/v1/users/me/profile") return json(response, { emailAddress: email });
      if (path === "/gmail/v1/users/me/messages") {
        state.mailAfterMs = Number(url.searchParams.get("q").match(/after:(\d+)/)[1]) * 1000;
        return json(response, { messages: [{ id: `${kind}-message` }] });
      }
      if (path.startsWith("/gmail/v1/users/me/messages/")) return json(response, { internalDate: String(state.mailAfterMs + 2000), payload: { body: { data: Buffer.from("Verification code: 123456").toString("base64url") } } });
      if (path === "/api/auth/email-otp/send-verification-otp") {
        assert.equal(request.headers.origin, base);
        assert.equal(body.type, "sign-in");
        state.otpSent[body.email] = true;
        return json(response, { success: true });
      }
      if (path === "/api/auth/sign-in/email-otp") {
        const loginKind = body.email === env.HYPERTASK_HEALTH_NO_FIREBASE_EMAIL ? "NO_FIREBASE" : "FIREBASE";
        assert.equal(body.otp, "123456");
        assert(state.otpSent[body.email]);
        return json(response, { user: { email: body.email } }, 200, { "Set-Cookie": [`better-auth.session_token=session-${loginKind}-secret; Path=/; HttpOnly`] });
      }
      if (path === "/api/auth/bridge-legacy-session") {
        const user = { id: kind === "FIREBASE" ? 991 : 992, email, uid: kind === "FIREBASE" ? "firebase-uid" : null };
        return json(response, { ok: true }, 200, { "Set-Cookie": [`ht_session=session-${kind}-secret; Path=/; HttpOnly`, `nookies_user=${encodeURIComponent(JSON.stringify(user))}; Path=/`] });
      }
      if (path === "/oauth/register") {
        const clientId = `client-${state.clients.size + 1}`;
        assert.equal(body.token_endpoint_auth_method, "none");
        assert.deepEqual(body.grant_types, ["authorization_code", "refresh_token"]);
        state.clients.set(clientId, { redirect: body.redirect_uris[0] });
        return json(response, { client_id: clientId }, 201);
      }
      if (path === "/oauth/authorize" && request.method === "GET") {
        if (options.fail === `mcp-login-${suffix(kind)}`) return secretError(response);
        const params = url.searchParams;
        assert.equal(params.get("code_challenge_method"), "S256");
        assert(request.headers.cookie.includes("ht_session="));
        const client = state.clients.get(params.get("client_id"));
        client.kind = kind;
        client.challenge = params.get("code_challenge");
        client.state = params.get("state");
        params.set("consent_token", "consent-secret");
        return json(response, {}, 307, { Location: `${base}/oauth/consent?${params}` });
      }
      if (path === "/oauth/consent") {
        response.writeHead(200, { "Content-Type": "text/html" });
        return response.end('<form action="/oauth/authorize"><input name="consent_token" value="consent-secret"></form>');
      }
      if (path === "/oauth/authorize") {
        assert.equal(body.consent_token, "consent-secret");
        const client = state.clients.get(body.client_id);
        const callback = new URL(client.redirect);
        callback.searchParams.set("code", `code-${body.client_id}-secret`);
        callback.searchParams.set("state", options.badState ? "invalid-state" : client.state);
        return json(response, {}, 303, { Location: `${base}/oauth/success?${new URLSearchParams({ code: `code-${body.client_id}-secret`, redirect_uri: callback.href })}` });
      }
      if (path === "/oauth/token") {
        const client = state.clients.get(body.client_id);
        if (body.grant_type === "authorization_code") {
          assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), client.challenge);
          assert.equal(body.code, `code-${body.client_id}-secret`);
          assert.equal(body.redirect_uri, client.redirect);
          client.owned = true;
        } else {
          assert.equal(body.grant_type, "refresh_token");
          assert.equal(body.refresh_token, `refresh-${client.kind}-secret`);
          state.refreshes += 1;
        }
        return json(response, { access_token: `fresh-${client.kind}-token-secret`, token_type: "Bearer", ...(options.refresh === false ? {} : { refresh_token: `refresh-${client.kind}-secret` }) });
      }
      if (path.startsWith("/api/connections/")) {
        assert.equal(request.method, "DELETE");
        assert.equal(request.headers.origin, base);
        if (options.fail === `session-cleanup-${suffix(kind)}`) return secretError(response);
        const clientId = path.split("/").at(-1);
        state.cleaned.push(clientId);
        return json(response, {}, state.clients.get(clientId).owned ? 200 : 404);
      }
      if (path === "/api/auth/sign-out") { state.signedOut.push(kind); return json(response, { success: true }); }
      if (unauthenticated && ["/api/mcp/tasks", "/api/ai-chat/all-sessions", "/api/ai/chat/stream", "/mcp"].includes(path)) {
        if (options.fail === "api-reachability") return json(response, {}, 403, { "x-vercel-mitigated": "challenge" });
        return json(response, { error: "Unauthorized" }, 401, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` });
      }
      if (path === "/api/mcp/user/context") return json(response, { user: { id: kind === "FIREBASE" ? 991 : 992 }, projects: [{ id: 71 }, ...(options.unsafeScope ? [{ id: 15 }] : [])] });
      if (path === "/api/mcp/projects") return json(response, { projects: [{ id: 71, sections: [{ id: 91 }, { id: 92 }] }] });
      if (path === "/mcp") {
        assert.equal(request.headers.accept, "application/json, text/event-stream");
        assert(request.headers.authorization?.startsWith("Bearer fresh-"));
        if (body.method === "notifications/initialized") return json(response, {}, 202);
        let result;
        if (body.method === "initialize") result = { serverInfo: { name: "Hypertask" }, capabilities: { tools: {} } };
        else if (body.method === "tools/list") result = { tools: (options.legacy ? ["create_task", "update_task", "get_tasks", "add_comment_to_task", "get_comments_for_task", "list_projects"] : ["tasks", "comments", "projects", "user_context"]).filter((name) => !options.missingTool || name !== "tasks").map((name) => ({ name: `hypertask_${name}` })) };
        else {
          assert.equal(body.method, "tools/call");
          const legacy = { create_task: ["tasks", "create"], update_task: ["tasks", "update"], get_tasks: ["tasks", "get"], add_comment_to_task: ["comments", "add"], get_comments_for_task: ["comments", "list"] };
          const name = body.params.name.slice("hypertask_".length);
          const [resource, action] = options.legacy ? legacy[name] : [name, body.params.arguments.action];
          const input = options.legacy ? body.params.arguments : body.params.arguments.input;
          if (!options.legacy) assert.equal(body.params.arguments.response_format, "detailed");
          const value = operation(resource, action, input, "mcp", response, kind);
          if (!value) return;
          const data = options.legacy ? value : { data: value, response_format: "detailed" };
          result = { content: [{ type: "text", text: JSON.stringify(data) }], ...(options.legacy ? {} : { structuredContent: data }) };
        }
        const payload = JSON.stringify({ jsonrpc: "2.0", id: body.id, result });
        if (options.rpcSse) { response.writeHead(200, { "Content-Type": "text/event-stream" }); return response.end(`event: message\ndata: ${payload}\n\n`); }
        response.writeHead(200, { "Content-Type": "application/json" });
        return response.end(payload);
      }
      if (path.startsWith("/api/mcp/tasks") || path === "/api/mcp/comments") {
        const source = request.headers["x-monitor-cli"] ? "cli" : "api";
        if (path === "/api/mcp/tasks" && !url.searchParams.has("task_id")) {
          const tasks = state.tasks.filter((item) => item.status === url.searchParams.get("status") && item.title === url.searchParams.get("search") && item.projectId === Number(url.searchParams.get("project_id")));
          return json(response, { tasks });
        }
        const resource = path.endsWith("comments") ? "comments" : "tasks";
        const action = request.method === "GET" ? (resource === "comments" ? "list" : "get") : (resource === "comments" ? "add" : path.split("/").at(-1));
        const value = operation(resource, action, request.method === "GET" ? Object.fromEntries(url.searchParams) : body, source, response);
        if (value) return json(response, value);
        return;
      }
      if (path === "/repos/hypertask-ai/cli/releases/latest") return json(response, { assets: [{ name: "hypertask-linux-x86_64", browser_download_url: `${base}/cli-binary`, digest: `sha256:${createHash("sha256").update(cliStub).digest("hex")}` }] });
      if (path === "/cli-binary") { response.writeHead(200); return response.end(cliStub); }
      if (path === "/api/ai-chat/create-session") return json(response, { success: true, session: { id: "00000000-0000-4000-8000-000000000001" } });
      if (path === "/api/ai/chat/stream") {
        assert.equal(body.aiFeature, "aiChat");
        assert.equal(body.default_context.project_id, 71);
        assert(body.user_message_id && body.assistant_message_id && body.stream_id);
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write('event: content\ndata: {"content":"');
        response.write(options.emptyAi ? '' : 'OK');
        response.write('"}\n\n');
        return response.end(options.fail === "ai-chat" ? 'event: error\ndata: {"content":"injected AI failure"}\n\nevent: done\ndata: {"status":"error"}\n\n' : 'event: done\ndata: {"status":"complete"}\n\n');
      }
      if (path === "/api/ai-chat/delete-session") { assert.equal(url.searchParams.get("delete"), "00000000-0000-4000-8000-000000000001"); state.chatDeleted = true; return json(response, { success: true }); }
      if (path.endsWith("/sendMessage")) { state.alerts.push(body.text); return json(response, { ok: true }); }
      throw new Error(`Unexpected request ${request.method} ${path}`);
    } catch (error) { state.errors.push(error.message); json(response, { error: error.message }, 500); }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${server.address().port}`;
  const urls = Object.fromEntries(["app", "mcp", "api", "google", "gmail", "github", "telegram"].map((name) => [name, base]));
  const { run } = await import(script);
  return {
    state, env, logs, directory,
    run: (extra = {}) => run({ env, urls, sleep: async () => {}, now: () => new Date("2026-10-05T08:17:00Z"), log: (line) => logs.push(line), ...extra }),
    close: async () => { server.closeAllConnections(); await new Promise((done) => server.close(done)); await rm(directory, { recursive: true, force: true }); },
  };
}

async function withFixture(options, action) {
  const context = await fixture(options);
  try { await action(context); assert.deepEqual(context.state.errors, [], "Mock wire contract assertions failed"); }
  finally { await context.close(); }
}

test("happy path performs both fresh PKCE logins, every transport, refresh, cleanup and a daily green", async () => {
  await withFixture({}, async ({ run, state, env }) => {
    const result = await run();
    assert.equal(result.ok, true, JSON.stringify(result.results));
    assert.equal(state.refreshes, 2);
    assert.equal(state.tasks.length, 4);
    assert(state.tasks.every((task) => task.status === "Deleted"));
    assert.equal(state.cleaned.length, 2);
    assert.equal(state.signedOut.length, 2);
    assert.equal(state.chatDeleted, true);
    assert.equal(state.alerts.length, 1);
    assert.match(state.alerts[0], /GREEN/);
    assert.match(await readFile(env.GITHUB_STEP_SUMMARY, "utf8"), /\| ai-chat \| PASS \| \d+ms/);
    await run();
    assert.equal(state.alerts.length, 1, "One heartbeat per day");
    await run({ now: () => new Date("2026-10-06T06:00:00Z") });
    assert.equal(state.alerts.length, 1, "No green before 07:00 UTC");
    await run({ now: () => new Date("2026-10-06T07:01:00Z") });
    assert.equal(state.alerts.length, 2, "First run after 07:00 sends the next daily green");
  });
});

for (const name of ["mcp-discovery", "api-reachability", "mcp-login-firebase", "mcp-login-no-firebase", "mcp-ops-firebase", "mcp-ops-no-firebase", "api-ops", "cli-ops", "ai-chat", "session-cleanup-firebase", "session-cleanup-no-firebase"]) {
  test(`${name} failure sends exactly one named alert and fails the run`, async () => {
    await withFixture({ fail: name, kind: name.includes("no-firebase") ? "NO_FIREBASE" : "FIREBASE" }, async ({ run, state }) => {
      const result = await run();
      assert.equal(result.ok, false);
      const failed = result.results.find((step) => step.name === name);
      assert.equal(failed?.outcome, "FAIL");
      if (name.includes("ops")) {
        assert.equal(String(failed.status), "503", "Cleanup must not replace the failing status with 200");
        assert(failed.url.endsWith(name === "cli-ops" ? "/api/mcp" : name.startsWith("mcp") ? "/mcp" : "/api/mcp/comments"));
      }
      assert.equal(state.alerts.length, 1);
      assert(state.alerts[0].includes(name));
      assert.match(state.alerts[0], /status=/);
      assert.match(state.alerts[0], /http:\/\/127.0.0.1/);
      assert(!state.alerts[0].includes("GREEN"));
      assert(state.tasks.every((task) => task.status === "Deleted"), "Task cleanup after mid-flow failure");
      if (name === "ai-chat") assert.equal(state.chatDeleted, true);
      if (name.startsWith("session-cleanup")) assert.equal(state.signedOut.length, 2, "Sign-out runs even if client cleanup fails");
    });
  });
}

test("logs, GitHub summary and Telegram redact configuration and issued credentials", async () => {
  await withFixture({ fail: "mcp-ops-firebase" }, async ({ run, state, logs, env }) => {
    await run();
    const output = logs.join("\n") + state.alerts.join("\n") + await readFile(env.GITHUB_STEP_SUMMARY, "utf8");
    for (const key of Object.keys(env).filter((name) => /TOKEN|SECRET|EMAIL|MAIL_CLIENT_ID|TELEGRAM_CHAT_ID/.test(name))) assert(!output.includes(env[key]), key);
    for (const value of ["fresh-FIREBASE-token-secret", "123456", "consent-secret", "session-FIREBASE-secret", "code-client-1-secret", "mail-FIREBASE-access-secret"]) assert(!output.includes(value), value);
    assert.match(output, /\[redacted\]/);
  });
});

test("missing credentials are NOT CONFIGURED failures, not silent skips", async () => {
  await withFixture({}, async ({ run, env, state, logs }) => {
    delete env.HYPERTASK_HEALTH_FIREBASE_MAIL_REFRESH_TOKEN;
    const result = await run();
    assert.equal(result.ok, false);
    assert.equal(state.alerts.length, 1);
    assert.match(logs.join("\n"), /NOT CONFIGURED: HYPERTASK_HEALTH_FIREBASE_MAIL_REFRESH_TOKEN/);
    assert.match(state.alerts[0], /NOT CONFIGURED: HYPERTASK_HEALTH_FIREBASE_MAIL_REFRESH_TOKEN/);
  });
});

test("missing Telegram configuration fails loudly even when an alert cannot be delivered", async () => {
  await withFixture({}, async ({ run, env, logs, state }) => {
    delete env.TELEGRAM_BOT_TOKEN;
    const result = await run();
    assert.equal(result.ok, false);
    assert.equal(state.alerts.length, 0);
    assert.match(logs.join("\n"), /NOT CONFIGURED: TELEGRAM_BOT_TOKEN/);
  });
});

for (const source of ["mcp", "api", "cli"]) {
  test(`lost ${source} create receipt still cleans up the task without retrying create`, async () => {
    await withFixture({ lostReceipt: source }, async ({ run, state }) => {
      const result = await run();
      assert.equal(result.ok, false);
      assert(state.tasks.every((task) => task.status === "Deleted"));
      assert.equal(state.tasks.filter((task) => task.title.startsWith(`Golden paths ${source} `)).length, source === "mcp" ? 2 : 1);
      assert.equal(state.alerts.length, 1);
    });
  });
}

test("OAuth state mismatch fails before exchanging a code", async () => {
  await withFixture({ badState: true }, async ({ run, state }) => {
    assert.equal((await run()).ok, false);
    assert.equal(state.requests.filter((request) => request.path === "/oauth/token").length, 0);
    assert.equal(state.alerts.length, 1);
  });
});

test("unsafe account board scope refuses all task and chat writes", async () => {
  await withFixture({ unsafeScope: true }, async ({ run, state }) => {
    assert.equal((await run()).ok, false);
    assert.equal(state.tasks.length, 0);
    assert(!state.chatDeleted);
    assert.equal(state.alerts.length, 1);
  });
});

test("legacy MCP catalog, JSON-RPC SSE and exchanges without refresh are supported", async () => {
  await withFixture({ legacy: true, rpcSse: true, refresh: false }, async ({ run, state }) => {
    const result = await run();
    assert.equal(result.ok, true, JSON.stringify(result.results));
    assert.equal(state.refreshes, 0);
  });
});

test("empty AI content is a failed golden path, even with a complete event", async () => {
  await withFixture({ emptyAi: true }, async ({ run, state }) => {
    const result = await run();
    assert.equal(result.results.find((step) => step.name === "ai-chat").outcome, "FAIL");
    assert.equal(state.chatDeleted, true);
    assert.equal(state.alerts.length, 1);
  });
});

test("read-only --only paths require no credentials and perform no login, alert or writes", async () => {
  await withFixture({}, async ({ run, state }) => {
    assert.equal((await run({ env: {}, only: ["mcp-discovery", "api-reachability"] })).ok, true);
    assert.equal(state.alerts.length, 0);
    assert.equal(state.tasks.length, 0);
    assert(!state.requests.some((request) => request.path.startsWith("/oauth/") || request.path.startsWith("/api/auth/")));
    await assert.rejects(() => run({ only: ["cli-ops"] }), /no writes/);
  });
});

test("workflow is independent, uses Node 24, persists heartbeat and documents exactly the consumed secrets", async () => {
  const yaml = require("js-yaml");
  const workflow = yaml.load(await readFile(".github/workflows/golden-paths.yml", "utf8"));
  assert.deepEqual(Object.keys(workflow.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.equal(workflow.on.schedule[0].cron, "17 */2 * * *");
  assert.equal(workflow.jobs.monitor["runs-on"], "ubuntu-latest");
  const steps = workflow.jobs.monitor.steps;
  assert(steps.some((step) => step.with?.["node-version"] === "24"));
  const configured = steps.find((step) => step.id === "monitor").env;
  const secrets = Object.keys(configured).filter((key) => key !== "GOLDEN_PATHS_STATE_FILE").sort();
  const source = await readFile(".github/scripts/golden-paths.mjs", "utf8");
  const docs = await readFile("docs/golden-paths.md", "utf8");
  for (const name of secrets) {
    assert(source.slice(0, source.indexOf("import ")).includes(name), `Header documents ${name}`);
    assert(docs.includes(name), `Setup documents ${name}`);
    assert.equal(configured[name], '${{ secrets.' + name + ' }}');
  }
  for (const path of [".github/workflows/golden-paths.yml", ".github/scripts/golden-paths.mjs", "tests/golden-paths.test.cjs", "docs/golden-paths.md"]) assert(!(await readFile(path, "utf8")).includes(String.fromCodePoint(0x2014)), path);
});
