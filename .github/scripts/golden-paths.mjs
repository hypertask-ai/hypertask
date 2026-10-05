// YPER4-198: fresh user login, never a stored Hypertask token or signing key.
// Secrets: HYPERTASK_HEALTH_FIREBASE_EMAIL, HYPERTASK_HEALTH_NO_FIREBASE_EMAIL,
// HYPERTASK_HEALTH_FIREBASE_MAIL_REFRESH_TOKEN,
// HYPERTASK_HEALTH_NO_FIREBASE_MAIL_REFRESH_TOKEN,
// HYPERTASK_HEALTH_MAIL_CLIENT_ID, HYPERTASK_HEALTH_MAIL_CLIENT_SECRET,
// HYPERTASK_HEALTH_PROJECT_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// Gmail credentials have gmail.readonly scope and belong only to health mailboxes.
// Full runs also require non-secret GOLDEN_PATHS_STATE_FILE. See docs/golden-paths.md.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const PRODUCTION = {
  app: "https://app.hypertask.ai",
  mcp: "https://mcp.hypertask.ai",
  api: "https://api.hypertask.ai",
  google: "https://oauth2.googleapis.com",
  gmail: "https://gmail.googleapis.com",
  github: "https://api.github.com",
  telegram: "https://api.telegram.org",
};
const ACCOUNTS = ["FIREBASE", "NO_FIREBASE"];
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

export async function run(options = {}) {
  const env = options.env ?? process.env;
  const urls = { ...PRODUCTION, ...options.urls };
  // Endpoint injection is only for local integration tests, never production env.
  if (options.urls && Object.values(urls).some((url) => !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname))) {
    throw new Error("Test endpoints must all be loopback URLs");
  }
  const sleep = options.sleep ?? pause;
  const now = options.now ?? (() => new Date());
  const results = [];
  const accounts = {};
  const secrets = new Set();
  const log = options.log ?? console.log;
  const remember = (value) => { if (typeof value === "string" && value) secrets.add(value); return value; };
  for (const [key, value] of Object.entries(env)) {
    if (/TOKEN|SECRET|PASSWORD|HEALTH_.*EMAIL|HEALTH_MAIL_CLIENT_ID|TELEGRAM_CHAT_ID/.test(key)) remember(value);
  }
  const redact = (value) => {
    let text = String(value);
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
      for (const form of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
        text = text.replaceAll(form, "[redacted]");
      }
    }
    return text.replace(/Bearer\s+\S+|\beyJ[\w.-]+|\b(?:htmk_|htk_)[\w-]+/gi, "[redacted]")
      .replace(/https?:\/\/[^\s<>"']+/g, (url) => {
        try { const parsed = new URL(url); return parsed.origin + parsed.pathname; } catch { return "[url]"; }
      }).replace(/[\r\n|]/g, " ");
  };
  const failure = (message) => Object.assign(new Error(message), { url: current?.url, status: current?.status });
  const required = (key) => {
    if (!env[key]) throw failure(`NOT CONFIGURED: ${key}`);
    return env[key];
  };
  let current;
  async function step(name, url, action) {
    const started = performance.now();
    current = { name, url, status: "n/a" };
    try {
      await action();
      results.push({ ...current, outcome: "PASS", ms: Math.round(performance.now() - started), error: "" });
    } catch (error) {
      results.push({ ...current, url: error.url ?? current.url, status: error.status ?? current.status, outcome: "FAIL", ms: Math.round(performance.now() - started), error: redact(error.message).slice(0, 300) });
    }
    const result = results.at(-1);
    result.url = redact(result.url);
    log(`${result.outcome} ${name} (${result.ms}ms) ${result.url} status=${result.status}${result.error ? ` ${result.error}` : ""}`);
  }
  async function request(url, init = {}, expected) {
    current.url = new URL(url).origin + new URL(url).pathname;
    current.status = "network";
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init });
        current.status = response.status;
        for (const cookie of response.headers.getSetCookie()) remember(cookie.split(";")[0].split("=").slice(1).join("="));
        const text = await response.text();
        const challenged = response.headers.has("x-vercel-mitigated");
        if (challenged || (expected ? response.status !== expected : !response.ok)) {
          throw failure(`${challenged ? "Vercel bot challenge; " : ""}HTTP ${response.status}: ${text.slice(0, 1000)}`);
        }
        return { response, text };
      } catch (error) {
        // Retry reads only. Retrying a consumed code, refresh or write can duplicate work.
        if ((init.method ?? "GET") !== "GET" || attempt === 2) {
          error.url = current.url;
          error.status = current.status;
          throw error;
        }
        await sleep(1000);
      }
    }
  }
  async function json(url, init = {}, expected) {
    const { text, response } = await request(url, init, expected);
    let data;
    try { data = JSON.parse(text); } catch { throw failure(`Expected JSON, received: ${text.slice(0, 300)}`); }
    for (const key of ["access_token", "refresh_token", "id_token"]) remember(data[key]);
    if (data.success === false || data.error) throw failure(String(data.error_description || data.message || data.error));
    return { data, response };
  }
  const post = (body) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const form = (body) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const check = (condition, message) => { if (!condition) throw failure(message); };
  const trusted = (url) => {
    check(new URL(url).origin === new URL(urls.app).origin, "OAuth metadata or redirect left the app origin");
    return url;
  };
  let metadata;
  async function discovery() {
    const { data: resource } = await json(`${urls.mcp}/.well-known/oauth-protected-resource`);
    check(resource.resource === `${urls.mcp}/mcp`, "Wrong MCP protected resource");
    check(resource.authorization_servers?.includes(urls.app), "Missing expected authorization server");
    const { data } = await json(`${urls.app}/.well-known/oauth-authorization-server`);
    check(data.issuer === urls.app && data.code_challenge_methods_supported?.includes("S256"), "Invalid OAuth issuer or missing PKCE S256");
    for (const key of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) trusted(data[key]);
    metadata = data;
  }
  async function reachability() {
    for (const url of [`${urls.app}/api/mcp/tasks`, `${urls.api}/api/mcp/tasks`, `${urls.app}/api/ai-chat/all-sessions`]) {
      await request(url, {}, 401);
    }
    await request(`${urls.app}/api/ai/chat/stream`, post({}), 401);
    const { response } = await request(`${urls.mcp}/mcp`, {
      ...post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "golden-paths", version: "1" } } }),
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    }, 401);
    check(response.headers.get("www-authenticate")?.includes("resource_metadata="), "MCP 401 lacks OAuth discovery challenge");
  }
  async function login(kind) {
    const email = required(`HYPERTASK_HEALTH_${kind}_EMAIL`);
    const refresh = required(`HYPERTASK_HEALTH_${kind}_MAIL_REFRESH_TOKEN`);
    const clientId = required("HYPERTASK_HEALTH_MAIL_CLIENT_ID");
    const clientSecret = required("HYPERTASK_HEALTH_MAIL_CLIENT_SECRET");
    const projectId = Number(required("HYPERTASK_HEALTH_PROJECT_ID"));
    check(Number.isSafeInteger(projectId) && projectId > 0 && ![15, 4060].includes(projectId), "Health project must be a dedicated sandbox, not a product or infra board");
    check(metadata, "MCP discovery failed; cannot log in");
    const { data: mail } = await json(`${urls.google}/token`, form({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, client_secret: clientSecret }));
    check(mail.access_token, "Mailbox token missing");
    const mailHeaders = { Authorization: `Bearer ${mail.access_token}` };
    const { data: profile } = await json(`${urls.gmail}/gmail/v1/users/me/profile`, { headers: mailHeaders });
    check(profile.emailAddress?.toLowerCase() === email.toLowerCase(), "Mailbox is not the health account");
    const sentAt = now().getTime();
    const originHeaders = { Origin: urls.app, "Content-Type": "application/json" };
    await json(`${urls.app}/api/auth/email-otp/send-verification-otp`, { ...post({ email, type: "sign-in" }), headers: originHeaders });
    let otp;
    function mailText(part) {
      return (part.body?.data ? Buffer.from(part.body.data, "base64url").toString("utf8") : "") + (part.parts ?? []).map(mailText).join("\n");
    }
    for (let attempt = 0; attempt < 18 && !otp; attempt += 1) {
      const query = new URLSearchParams({ q: `to:${email} from:noreply@hypertask.ai subject:"Sign in to Hypertask" after:${Math.floor(sentAt / 1000)}`, maxResults: "5" });
      const { data: listing } = await json(`${urls.gmail}/gmail/v1/users/me/messages?${query}`, { headers: mailHeaders });
      for (const message of listing.messages ?? []) {
        const { data: full } = await json(`${urls.gmail}/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=full`, { headers: mailHeaders });
        if (Number(full.internalDate) < sentAt) continue;
        otp = mailText(full.payload ?? {}).match(/\b\d{6}\b/)?.[0];
        if (otp) { remember(otp); break; }
      }
      if (!otp) await sleep(5000);
    }
    check(otp, "No fresh health sign-in OTP arrived within 90 seconds");
    const { response: signedIn } = await json(`${urls.app}/api/auth/sign-in/email-otp`, { ...post({ email, otp }), headers: originHeaders });
    const cookies = new Map(signedIn.headers.getSetCookie().map((cookie) => {
      const pair = cookie.split(";")[0];
      return [pair.slice(0, pair.indexOf("=")), pair];
    }));
    const account = { projectId, headers: { Cookie: [...cookies.values()].join("; "), Origin: urls.app } };
    accounts[kind] = account;
    const { response: bridged } = await json(`${urls.app}/api/auth/bridge-legacy-session`, {
      method: "POST", headers: account.headers,
    });
    for (const cookie of bridged.headers.getSetCookie()) {
      const pair = cookie.split(";")[0];
      cookies.set(pair.slice(0, pair.indexOf("=")), pair);
    }
    account.headers.Cookie = [...cookies.values()].join("; ");
    check(cookies.has("ht_session") && cookies.has("nookies_user"), "Sign-in did not issue signed ht_session and user cookies");
    const user = JSON.parse(decodeURIComponent(cookies.get("nookies_user").slice("nookies_user=".length)));
    account.user = user;
    check(user.email?.toLowerCase() === email.toLowerCase() && user.id !== 6, "Wrong identity or forbidden owner account");
    check(kind === "FIREBASE" ? Boolean(user.uid) : !user.uid, `Health account ${kind} has the wrong uid shape`);
    const redirectUri = "http://127.0.0.1:43198/callback";
    const { data: registered } = await json(metadata.registration_endpoint, post({
      client_name: "Hypertask golden paths", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none",
    }), 201);
    check(registered.client_id, "Dynamic registration omitted client_id");
    account.clientId = registered.client_id;
    const verifier = remember(randomBytes(32).toString("base64url"));
    const state = remember(randomUUID());
    const params = new URLSearchParams({ response_type: "code", client_id: account.clientId, redirect_uri: redirectUri, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state, resource: `${urls.mcp}/mcp`, scope: "mcp:full" });
    const { response: authorized } = await request(`${metadata.authorization_endpoint}?${params}`, { headers: account.headers }, 307);
    const consentUrl = new URL(authorized.headers.get("location"), urls.app);
    trusted(consentUrl);
    check(consentUrl.pathname === "/oauth/consent", "Fresh client was not offered consent; session may have redirected to login");
    const consentToken = remember(consentUrl.searchParams.get("consent_token"));
    check(consentToken, "Consent token missing");
    const { text: html } = await request(consentUrl, { headers: account.headers });
    check(html.includes('name="consent_token"') && html.includes('action="/oauth/authorize"'), "Consent form missing");
    params.set("consent_token", consentToken);
    const { response: approved } = await request(metadata.authorization_endpoint, { ...form(params), headers: { ...form(params).headers, ...account.headers } }, 303);
    let callback = new URL(approved.headers.get("location"), urls.app);
    if (callback.pathname === "/oauth/success") {
      trusted(callback);
      remember(callback.searchParams.get("code"));
      callback = new URL(callback.searchParams.get("redirect_uri"));
    }
    const code = remember(callback.searchParams.get("code"));
    check(callback.origin + callback.pathname === redirectUri && callback.searchParams.get("state") === state && code, "OAuth callback URI, state or code invalid");
    let { data: token } = await json(metadata.token_endpoint, form({ grant_type: "authorization_code", client_id: account.clientId, redirect_uri: redirectUri, code, code_verifier: verifier, resource: `${urls.mcp}/mcp` }));
    check(token.access_token && token.token_type?.toLowerCase() === "bearer", "Code exchange did not issue a bearer token");
    account.token = token.access_token;
    if (token.refresh_token) {
      account.refreshToken = token.refresh_token;
      ({ data: token } = await json(metadata.token_endpoint, form({ grant_type: "refresh_token", client_id: account.clientId, refresh_token: account.refreshToken })));
      check(token.access_token, "Refresh did not issue an access token");
      account.refreshToken = token.refresh_token ?? account.refreshToken;
    }
    account.token = token.access_token;
    await sandbox(account);
  }
  async function rest(account, path, init = {}) {
    const { data } = await json(`${urls.app}/api/mcp${path}`, { ...init, headers: { Authorization: `Bearer ${account.token}`, Accept: "application/json", ...init.headers } });
    return data;
  }
  async function sandbox(account) {
    check(account?.token, "Fresh MCP login unavailable");
    const context = await rest(account, "/user/context");
    check(context.user?.id === account.user.id && !context.connected_agent, "Token does not identify the signed-in health user");
    check(context.projects?.length === 1 && context.projects[0].id === account.projectId, "Health identity must have access to the dedicated sandbox only");
    const projects = await rest(account, "/projects?limit=100");
    const project = projects.projects?.find((item) => item.id === account.projectId);
    check(project?.sections?.length >= 2, "Sandbox needs two columns");
    account.sections = project.sections.slice(0, 2);
  }
  async function rpc(account, method, params = {}) {
    const id = randomUUID();
    const { text } = await request(`${urls.mcp}/mcp`, {
      ...post({ jsonrpc: "2.0", id, method, params }),
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" },
    });
    const frame = text.startsWith("event:") || text.startsWith("data:")
      ? text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).find((line) => line.startsWith("{")) : text;
    const message = JSON.parse(frame);
    check(message.id === id && message.jsonrpc === "2.0", "Invalid JSON-RPC response identity");
    if (message.error) throw failure(`JSON-RPC ${message.error.code}: ${message.error.message}`);
    check(message.result, "Missing JSON-RPC result");
    return message.result;
  }
  async function tools(account) {
    const initialized = await rpc(account, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "golden-paths", version: "1" } });
    check(initialized.serverInfo && initialized.capabilities?.tools, "MCP initialize missing server info or tools capability");
    await request(`${urls.mcp}/mcp`, {
      ...post({ jsonrpc: "2.0", method: "notifications/initialized" }),
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    }, 202);
    const catalog = await rpc(account, "tools/list");
    const names = new Set(catalog.tools?.map((tool) => tool.name));
    const consolidated = names.has("hypertask_tasks");
    for (const name of consolidated ? ["hypertask_tasks", "hypertask_comments", "hypertask_projects", "hypertask_user_context"] : ["hypertask_create_task", "hypertask_update_task", "hypertask_get_tasks", "hypertask_add_comment_to_task", "hypertask_get_comments_for_task", "hypertask_list_projects"]) {
      check(names.has(name), `Missing core MCP tool: ${name}`);
    }
    return async (resource, action, input) => {
      const legacy = { "tasks/create": "create_task", "tasks/update": "update_task", "tasks/get": "get_tasks", "comments/add": "add_comment_to_task", "comments/list": "get_comments_for_task" };
      if (resource === "tasks" && action === "get") input = { ...input, task_id: [input.task_id] };
      const args = consolidated ? { action, input, response_format: "detailed" } : { ...input };
      if (!consolidated && args.section_id && action === "update") { args.sectionId = args.section_id; delete args.section_id; }
      const result = await rpc(account, "tools/call", { name: consolidated ? `hypertask_${resource}` : `hypertask_${legacy[`${resource}/${action}`]}`, arguments: args });
      if (result.isError) throw failure(result.content?.map((item) => item.text ?? "").join(" ") || "MCP tool failed");
      const data = result.structuredContent ?? JSON.parse(result.content?.find((item) => item.type === "text")?.text ?? "null");
      const value = consolidated ? data?.data : data;
      check(value && value.success !== false && !value.error, "MCP operation failed or returned no data");
      return value;
    };
  }
  function verifyTask(data, title, account, status = "Normal") {
    const task = data.tasks?.[0] ?? data.task;
    check(task?.title === title && task.projectId === account.projectId && task.sectionId === account.sections[1].id && task.status === status && task.description?.includes("Golden path fixture"), "Task readback fields differ from writes");
  }
  async function operations(account, transport) {
    await sandbox(account);
    const title = `Golden paths ${transport} ${randomUUID()}`;
    let taskId;
    const call = transport === "mcp" ? await tools(account) : async (resource, action, input) => {
      if (action === "get" || action === "list") return rest(account, `/${resource}?${new URLSearchParams(input)}`);
      if (resource === "tasks" && action === "update" && input.section_id) { input.sectionId = input.section_id; delete input.section_id; }
      return rest(account, resource === "comments" ? "/comments" : `/tasks/${action}`, { ...post(input), headers: { ...post(input).headers, "Idempotency-Key": `${title}-${resource}-${action}-${input.status ?? "normal"}` } });
    };
    try {
      const created = await call("tasks", "create", { project_id: account.projectId, section_id: account.sections[0].id, title, description: "<p>Golden path fixture</p>", priority: 0, estimate: 0 });
      taskId = created.task?.id;
      check(taskId, "Create returned no task id");
      await call("comments", "add", { task_id: taskId, text: "<p>Golden path comment</p>" });
      await call("tasks", "update", { task_id: taskId, section_id: account.sections[1].id });
      verifyTask(await call("tasks", "get", { task_id: taskId }), title, account);
      const comments = await call("comments", "list", { task_id: taskId });
      check(comments.comments?.some((item) => (item.text ?? item.commentText ?? "").includes("Golden path comment")), "Comment missing on readback");
      await call("tasks", "update", { task_id: taskId, status: "Archive" });
      verifyTask(await call("tasks", "get", { task_id: taskId }), title, account, "Archive");
      await call("tasks", "update", { task_id: taskId, status: "Deleted" });
      verifyTask(await call("tasks", "get", { task_id: taskId }), title, account, "Deleted");
    } finally {
      await cleanupTask(account, title, taskId);
    }
  }
  async function cleanupTask(account, title, taskId) {
    // Recover lost create receipts by exact unique title, scoped to this sandbox.
    if (!taskId) {
      const listing = await rest(account, `/tasks?project_id=${account.projectId}&status=Normal&search=${encodeURIComponent(title)}&limit=10`);
      taskId = listing.tasks?.find((task) => task.title === title && task.projectId === account.projectId)?.id;
    }
    if (!taskId) return;
    for (let attempt = 0; ; attempt += 1) {
      try { await rest(account, "/tasks/update", post({ task_id: taskId, status: "Deleted" })); return; }
      catch (error) { if (attempt === 2) throw failure(`Cleanup failed: ${error.message}`); await sleep(1000); }
    }
  }
  async function cli(account) {
    await sandbox(account);
    const directory = await mkdtemp(join(tmpdir(), "golden-paths-"));
    const binary = join(directory, "hypertask");
    const title = `Golden paths cli ${randomUUID()}`;
    let taskId;
    const invoke = async (args) => {
      current.url = `${urls.api}/api/mcp`;
      current.status = "CLI";
      try {
        const { stdout } = await execute(binary, [...args, "--json"], {
          timeout: 45_000, maxBuffer: 1024 * 1024,
          env: { PATH: process.env.PATH, HOME: directory, HYPERTASKS_JWT_TOKEN: account.token, HYPERTASKS_API_URL: `${urls.api}/api` },
        });
        const data = JSON.parse(stdout);
        check(data.success !== false && !data.error, "CLI reported failure");
        current.status = "exit 0";
        return data;
      } catch (error) {
        current.status = error.stderr?.match(/HTTP\s+(\d{3})/)?.[1] ?? `exit ${error.code ?? "error"}`;
        throw failure(`CLI ${args.slice(0, 2).join(" ")}: ${error.stderr || error.message}`);
      }
    };
    try {
      const { data: release } = await json(`${urls.github}/repos/hypertask-ai/cli/releases/latest`);
      const asset = release.assets?.find((item) => item.name === "hypertask-linux-x86_64");
      check(asset, "Latest CLI release has no Linux x86_64 binary");
      const assetUrl = new URL(asset.browser_download_url);
      check(options.urls ? assetUrl.origin === urls.github : assetUrl.origin === "https://github.com" && assetUrl.pathname.startsWith("/hypertask-ai/cli/releases/download/"), "Unexpected CLI download origin");
      current.url = assetUrl.origin + assetUrl.pathname;
      const response = await fetch(assetUrl, { signal: AbortSignal.timeout(60_000) });
      current.status = response.status;
      check(response.ok, `CLI download HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      check(asset.digest?.startsWith("sha256:"), "CLI release asset has no SHA-256 digest");
      check(`sha256:${createHash("sha256").update(bytes).digest("hex")}` === asset.digest, "CLI binary checksum mismatch");
      await writeFile(binary, bytes);
      await chmod(binary, 0o700);
      const created = await invoke(["task", "create", "--project", String(account.projectId), "--title", title, "--description", "<p>Golden path fixture</p>", "--section", String(account.sections[0].id)]);
      taskId = created.task?.id;
      check(taskId, "CLI create returned no task id");
      await invoke(["comment", "add", String(taskId), "--text", "<p>Golden path comment</p>"]);
      const data = await invoke(["tasks", "get", String(taskId)]);
      check(data.tasks?.[0]?.id === taskId && data.tasks[0].title === title, "CLI task readback mismatch");
      await invoke(["task", "update", String(taskId), "--status", "Deleted"]);
      const deleted = await invoke(["tasks", "get", String(taskId)]);
      check(deleted.tasks?.[0]?.status === "Deleted", "CLI delete did not put the task in trash");
    } finally {
      try { await cleanupTask(account, title, taskId); } finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
  async function chat(account) {
    await sandbox(account);
    let sessionId;
    try {
      const { data } = await json(`${urls.app}/api/ai-chat/create-session`, { ...post({}), headers: { ...post({}).headers, ...account.headers } });
      sessionId = data.session?.id;
      check(sessionId, "AI chat created no session");
      const { response, text } = await request(`${urls.app}/api/ai/chat/stream`, {
        ...post({ message: "Reply with the word OK only. Do not use tools.", aiFeature: "aiChat", session_id: sessionId, user_message_id: randomUUID(), assistant_message_id: randomUUID(), stream_id: randomUUID(), default_context: { project_id: account.projectId }, chat_history: [] }),
        headers: { ...post({}).headers, ...account.headers, Accept: "text/event-stream" }, signal: AbortSignal.timeout(180_000),
      });
      check(response.headers.get("content-type")?.includes("text/event-stream"), "AI reply is not an event stream");
      let content = "";
      let complete = false;
      for (const frame of text.replaceAll("\r\n", "\n").split("\n\n")) {
        const event = frame.match(/^event: ?(.+)$/m)?.[1];
        const payload = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!payload) continue;
        const value = JSON.parse(payload);
        if (event === "error" || (event === "done" && value.status !== "complete")) throw failure(`AI stream error: ${value.content || value.status}`);
        if (event === "content") content += value.content ?? "";
        if (event === "done") complete = true;
      }
      check(content.trim() && complete, "AI stream ended without a non-empty completed reply");
    } finally {
      if (sessionId) await json(`${urls.app}/api/ai-chat/delete-session?delete=${encodeURIComponent(sessionId)}`, { method: "DELETE", headers: account.headers });
    }
  }
  let heartbeatState = {};
  const only = options.only;
  if (only && (only.length === 0 || only.some((name) => !["mcp-discovery", "api-reachability"].includes(name)))) throw new Error("--only accepts mcp-discovery,api-reachability only (no writes)");
  if (!only || only.includes("mcp-discovery")) await step("mcp-discovery", `${urls.mcp}/.well-known/oauth-protected-resource`, discovery);
  if (!only || only.includes("api-reachability")) await step("api-reachability", `${urls.api}/api/mcp/tasks`, reachability);
  if (!only) {
    await step("report-config", urls.telegram, async () => {
      required("TELEGRAM_BOT_TOKEN");
      required("TELEGRAM_CHAT_ID");
      const stateFile = required("GOLDEN_PATHS_STATE_FILE");
      try { heartbeatState = JSON.parse(await readFile(stateFile, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    });
    try {
      for (const kind of ACCOUNTS) await step(`mcp-login-${kind.toLowerCase().replaceAll("_", "-")}`, `${urls.app}/oauth/authorize`, () => login(kind));
      for (const kind of ACCOUNTS) await step(`mcp-ops-${kind.toLowerCase().replaceAll("_", "-")}`, `${urls.mcp}/mcp`, () => operations(accounts[kind], "mcp"));
      await step("api-ops", `${urls.app}/api/mcp/tasks/create`, () => operations(accounts.FIREBASE, "api"));
      await step("cli-ops", `${urls.api}/api/mcp`, () => cli(accounts.NO_FIREBASE));
      await step("ai-chat", `${urls.app}/api/ai/chat/stream`, () => chat(accounts.FIREBASE));
    } finally {
      for (const [kind, account] of Object.entries(accounts)) {
        await step(`session-cleanup-${kind.toLowerCase().replaceAll("_", "-")}`, `${urls.app}/api/connections`, async () => {
          try {
            if (account.clientId) await request(`${urls.app}/api/connections/${encodeURIComponent(account.clientId)}`, { method: "DELETE", headers: account.headers }, account.token ? 200 : 404);
          } finally {
            await json(`${urls.app}/api/auth/sign-out`, { ...post({}), headers: { ...post({}).headers, ...account.headers } });
          }
        });
      }
    }
  }
  async function notify(text) {
    const { data } = await json(`${urls.telegram}/bot${required("TELEGRAM_BOT_TOKEN")}/sendMessage`, post({ chat_id: required("TELEGRAM_CHAT_ID"), text: redact(text).slice(0, 3900), disable_web_page_preview: true }));
    check(data.ok === true, "Telegram did not accept the monitor report");
  }
  const failures = results.filter((result) => result.outcome === "FAIL");
  if (!only) {
    await step("report", urls.telegram, async () => {
      if (failures.length) {
        // One aggregated alert and one send attempt, never one alert per retry.
        await notify(`Golden paths FAIL\n${failures.map((item) => `${item.name}: ${item.url} status=${item.status} ${item.error.slice(0, 100)}`).join("\n")}`);
      } else {
        const date = now();
        const day = date.toISOString().slice(0, 10);
        const stateFile = env.GOLDEN_PATHS_STATE_FILE;
        if (date.getUTCHours() >= 7 && heartbeatState.greenDay !== day) {
          await notify(`Golden paths GREEN ${day}: both logins, MCP, API, CLI and AI chat passed.`);
          await writeFile(stateFile, JSON.stringify({ greenDay: day }));
        }
      }
    });
  }
  const table = ["## Golden paths", "", "| Step | Result | Time | URL | Status | Detail |", "| --- | --- | ---: | --- | --- | --- |", ...results.map((item) => `| ${item.name} | ${item.outcome} | ${item.ms}ms | ${item.url} | ${item.status} | ${item.error} |`)].join("\n") + "\n";
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, table);
  const ok = results.every((result) => result.outcome === "PASS");
  log(`Golden paths ${ok ? "PASS" : "FAIL"}`);
  return { ok, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const onlyArg = args.find((arg) => arg.startsWith("--only="));
  if (args.some((arg) => arg !== onlyArg)) {
    console.error("Usage: node .github/scripts/golden-paths.mjs [--only=mcp-discovery,api-reachability]");
    process.exitCode = 1;
  } else {
    try { process.exitCode = (await run({ only: onlyArg?.slice(7).split(",") })).ok ? 0 : 1; }
    catch { console.error("Golden paths FAIL: monitor could not finish reporting"); process.exitCode = 1; }
  }
}
