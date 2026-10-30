import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function requireThat(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.contractAssertion = true;
    throw error;
  }
}

export function loopbackUrl(value, base) {
  const url = new URL(value, base);
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  requireThat(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password, "Refused non-loopback URL");
  if (base) requireThat(url.origin === new URL(base).origin, "Refused different loopback origin");
  return url;
}

export async function requestLocal(base, route, options = {}) {
  const url = loopbackUrl(route, loopbackUrl(base));
  return fetch(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(60_000) });
}

export async function responseJson(response, label) {
  requireThat(response.ok, `${label}: HTTP ${response.status}`);
  let value;
  try { value = await response.json(); } catch { throw new Error(`${label}: invalid JSON`); }
  requireThat(value && typeof value === "object" && !value.error && value.success !== false, `${label}: unsuccessful response`);
  return value;
}

export function assertRpcResult(envelope, id, label) {
  requireThat(envelope?.jsonrpc === "2.0" && envelope.id === id, `${label}: invalid JSON-RPC envelope`);
  requireThat(envelope.error === undefined && envelope.result && (envelope.result.isError === undefined || envelope.result.isError === false), `${label}: JSON-RPC/tool error`);
  return envelope.result;
}

export function assertTools(result, expected) {
  requireThat(Array.isArray(result?.tools) && result.tools.length > 0, "tools/list: empty catalog");
  for (const name of expected) {
    requireThat(result.tools.some(tool => tool.name === name && tool.inputSchema?.type === "object"), `tools/list: missing core tool ${name}`);
  }
  for (const tool of result.tools) {
    requireThat(tool.inputSchema?.type === "object", `tools/list: ${tool.name} must have an object inputSchema`);
    for (const keyword of ["oneOf", "allOf", "anyOf"]) {
      requireThat(!Object.hasOwn(tool.inputSchema, keyword), `tools/list: ${tool.name} has unsupported top-level ${keyword}`);
    }
  }
}

export function toolData(result, label) {
  let value = result.structuredContent;
  if (!value) {
    const text = result.content?.find(item => item.type === "text")?.text;
    try { value = JSON.parse(text); } catch { throw new Error(`${label}: missing JSON tool content`); }
  }
  value = value.data ?? value;
  requireThat(value && typeof value === "object" && !value.error && value.success !== false, `${label}: unsuccessful tool data`);
  return value;
}

export function assertCliTrace(trace, base) {
  const url = loopbackUrl(base);
  const connections = trace.split("\n").filter(line => /connect\(/.test(line) && /AF_INET6?/.test(line));
  requireThat(connections.length > 0, "CLI: no traced HTTP connection");
  for (const line of connections) {
    requireThat(line.includes(`sin_port=htons(${url.port || 80})`) && line.includes(`inet_addr("${url.hostname}")`), "CLI: non-loopback or unexpected network destination");
  }
}

async function rpcEnvelope(base, token, method, params) {
  const id = randomUUID();
  const response = await requestLocal(base, "/mcp", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  requireThat(response.ok, `${method}: HTTP ${response.status}`);
  const text = await response.text();
  let envelope;
  try {
    envelope = response.headers.get("content-type")?.includes("text/event-stream")
      ? text.split(/\r?\n\r?\n/).flatMap(event => event.split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)))).find(item => item.id === id)
      : JSON.parse(text);
  } catch { throw new Error(`${method}: invalid JSON-RPC encoding`); }
  return { envelope, id };
}

async function rpc(base, token, method, params) {
  const { envelope, id } = await rpcEnvelope(base, token, method, params);
  return assertRpcResult(envelope, id, method);
}

function cookieHeader(caller) {
  return caller.cookies.filter(cookie => ["ht_session", "nookies_user"].includes(cookie.name)).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

async function mint(base, caller) {
  const result = await responseJson(await requestLocal(base, "/api/mcp/token", {
    method: "POST", headers: { Cookie: cookieHeader(caller) },
  }), "mint user bearer");
  requireThat(typeof result.token === "string" && result.token.length > 0, "mint user bearer: no token");
  return result.token;
}

async function oauth(base, owner) {
  const callback = `${base}/contract-callback`;
  const registration = await responseJson(await requestLocal(base, "/oauth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "Disposable contract", redirect_uris: [callback], token_endpoint_auth_method: "none", grant_types: ["authorization_code"] }),
  }), "OAuth registration");
  requireThat(typeof registration.client_id === "string", "OAuth registration: no client id");
  const verifier = randomBytes(32).toString("base64url");
  const state = randomUUID();
  const params = new URLSearchParams({ response_type: "code", client_id: registration.client_id, redirect_uri: callback, state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  const headers = { Cookie: cookieHeader(owner) };
  const authorize = await requestLocal(base, `/oauth/authorize?${params}`, { headers });
  requireThat([302, 303, 307].includes(authorize.status), "OAuth authorize: no consent redirect");
  const consent = loopbackUrl(authorize.headers.get("location"), base);
  requireThat(consent.pathname === "/oauth/consent" && consent.searchParams.has("consent_token"), "OAuth authorize: missing signed consent");
  const consentPage = await requestLocal(base, consent.href, { headers });
  requireThat(consentPage.ok, "OAuth consent: page unavailable");
  await consentPage.arrayBuffer();
  params.set("consent_token", consent.searchParams.get("consent_token"));
  const approved = await requestLocal(base, "/oauth/authorize", {
    method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString(),
  });
  requireThat(approved.status === 303, "OAuth approval: missing redirect");
  const success = loopbackUrl(approved.headers.get("location"), base);
  const redirect = success.pathname === "/oauth/success" ? loopbackUrl(success.searchParams.get("redirect_uri"), base) : success;
  requireThat(redirect.pathname === "/contract-callback" && redirect.searchParams.get("state") === state && redirect.searchParams.has("code"), "OAuth approval: invalid callback");
  const result = await responseJson(await requestLocal(base, "/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: registration.client_id, redirect_uri: callback,
      code: redirect.searchParams.get("code"), code_verifier: verifier }).toString(),
  }), "OAuth code exchange");
  requireThat(typeof result.access_token === "string" && result.token_type?.toLowerCase() === "bearer", "OAuth code exchange: no bearer");
  return result.access_token;
}

function taskRow(data, id, title) {
  const task = data.tasks?.find(row => row.id === id);
  requireThat(task?.title === title, "task read: expected id and title not found");
  return task;
}

async function cliContract(base, binary, token, board, rest) {
  const home = await mkdtemp(path.join(tmpdir(), "mcp-contract-cli-"));
  try {
    async function run(args) {
      const traceFile = path.join(home, "connect.trace");
      const result = await new Promise((resolve, reject) => {
        const child = spawn("strace", ["-f", "-e", "trace=connect", "-o", traceFile, binary, ...args, "--json"], {
          env: { PATH: process.env.PATH, HOME: home, TMPDIR: home, HYPERTASKS_API_URL: `${base}/api`, HT_TOKEN: token },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let helperRefusal = false;
        child.stdout.on("data", chunk => { stdout += chunk; });
        child.stderr.on("data", chunk => {
          helperRefusal ||= chunk.toString().includes("helpers never write to the board");
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
        child.on("error", () => { clearTimeout(timer); reject(new Error("CLI: launch failed")); });
        child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, helperRefusal }); });
      });
      requireThat(!result.helperRefusal, `CLI ${args[0]} ${args[1]}: pinned release refuses helper writes; rerun from the runner shell or hosted CI`);
      try { assertCliTrace(await readFile(traceFile, "utf8"), base); }
      catch (error) { requireThat(false, `CLI ${args[0]} ${args[1]}: ${error.message}`); }
      requireThat(result.code === 0, `CLI ${args[0]} ${args[1]}: failed`);
      let data;
      try { data = JSON.parse(result.stdout); } catch { throw new Error("CLI: invalid JSON output"); }
      requireThat(data && !data.error && data.success !== false, "CLI: unsuccessful result");
      return data;
    }
    const listed = await run(["projects", "list"]);
    requireThat(listed.projects?.some(row => row.id === board.id), "CLI boards: contract board missing");
    const boards = await rest("/projects");
    requireThat(boards.projects?.some(row => row.id === board.id), "REST boards: contract board missing");
    taskRow(await run(["tasks", "get", String(board.task.id)]), board.task.id, board.task.title);
    taskRow(await rest(`/tasks?task_id=${board.task.id}`), board.task.id, board.task.title);
    console.log("CLI: board list and seeded task read match REST (loopback trace checked)");
    const title = `CLI contract ${randomUUID()}`;
    const created = await run(["tasks", "create", "--project", String(board.id), "--title", title]);
    requireThat(Number.isInteger(created.task?.id) && created.task.title === title, "CLI create: invalid receipt");
    const id = created.task.id;
    taskRow(await rest(`/tasks?task_id=${id}`), id, title);
    const text = `CLI comment ${randomUUID()}`;
    const comment = await run(["comments", "add", String(id), "--text", text]);
    requireThat(Number.isInteger(comment.comment?.id), "CLI comment: invalid receipt");
    const comments = await rest(`/comments?task_id=${id}`);
    requireThat(comments.comments?.some(row => row.id === comment.comment.id && row.text.includes(text)), "REST CLI comment: missing content");
    await run(["tasks", "move", String(id), "--section", String(board.columns[1].id)]);
    requireThat(taskRow(await rest(`/tasks?task_id=${id}`), id, title).sectionId === board.columns[1].id, "REST CLI move: wrong column");
    console.log("CLI: boards, task, create, comment, column move and REST readbacks passed (loopback trace checked)");
  } finally { await rm(home, { recursive: true, force: true }); }
}

export async function runContract() {
  const base = loopbackUrl(process.env.BASE_URL ?? "http://127.0.0.1:3100").origin;
  const fixture = JSON.parse(await readFile(process.env.MCP_CONTRACT_FIXTURE ?? path.join(root, "e2e/smoke/.state/contract-fixture.json"), "utf8"));
  const binary = process.env.MCP_CONTRACT_CLI;
  requireThat(binary && path.isAbsolute(binary), "MCP_CONTRACT_CLI must be the absolute path to the checksum-verified native CLI");
  const [board] = fixture.boards;
  requireThat(board?.columns?.length === 2 && fixture.callers?.unaccepted, "Missing opt-in contract fixtures");
  const descriptions = {};
  for (const family of ["projects", "tasks", "search", "comments", "labels", "pages"]) {
    descriptions[family] = JSON.parse(await readFile(path.join(root, `src/lib/mcp-server/config/descriptions/${family}.json`), "utf8"));
  }
  const operations = [["projects", "list"], ["tasks", "get"], ["search", "tasks"], ["tasks", "create"], ["comments", "add"],
    ["comments", "list"], ["tasks", "update"], ["labels", "list"], ["pages", "create"], ["pages", "get"]];
  const coreNames = pairs => [...new Set(pairs.map(([family]) => descriptions[family].name))];
  const tokens = {};
  for (const role of ["owner", "member", "guest", "unaccepted"]) tokens[role] = await mint(base, fixture.callers[role]);
  async function rest(route, token = tokens.owner, options = {}) {
    return responseJson(await requestLocal(base, `/api/mcp${route}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } }), `REST ${route.split("?")[0]}`);
  }
  for (const role of ["write", "read"]) {
    const agent = await rest("/agents/create", tokens.owner, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: `Contract ${role} ${randomUUID()}`, project_ids: fixture.boards.map(row => row.id), role }) });
    requireThat(typeof agent.token === "string" && typeof agent.agent?.id === "string", "Agent creation: invalid receipt");
    tokens[`${role}-agent`] = agent.token;
  }
  tokens.oauth = await oauth(base, fixture.callers.owner);
  async function call(token, family, action, input) {
    const definition = descriptions[family];
    const result = await rpc(base, token, "tools/call", {
      name: definition.name,
      arguments: { action, input, response_format: "detailed" },
    });
    return toolData(result, `${family}/${action}`);
  }
  async function initialize(token, pairs) {
    const result = await rpc(base, token, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "disposable-contract", version: "1" } });
    requireThat(result.protocolVersion && result.capabilities?.tools, "initialize: missing tool capabilities");
    assertTools(await rpc(base, token, "tools/list", {}), coreNames(pairs));
  }
  for (const role of ["owner", "member", "guest", "write-agent", "oauth"]) {
    const token = tokens[role];
    await initialize(token, operations);
    const projects = await call(token, "projects", "list", {});
    requireThat(projects.projects?.some(row => row.id === board.id), `${role}: seeded board missing`);
    taskRow(await call(token, "tasks", "get", { task_id: [board.task.id] }), board.task.id, board.task.title);
    taskRow(await call(token, "search", "tasks", { query: "contract", project_id: board.id }), board.task.id, board.task.title);
    const title = `${role} contract ${randomUUID()}`;
    const created = await call(token, "tasks", "create", { project_id: board.id, title, section_id: board.columns[0].id });
    requireThat(Number.isInteger(created.task?.id) && created.task.title === title, `${role}: invalid created task`);
    const id = created.task.id;
    taskRow(await rest(`/tasks?task_id=${id}`, token), id, title);
    const text = `${role} comment ${randomUUID()}`;
    const added = await call(token, "comments", "add", { task_id: id, text, ...(role === "write-agent" ? { kind: "qa" } : {}) });
    requireThat(Number.isInteger(added.comment?.id), `${role}: invalid comment receipt`);
    requireThat(added.routedTo === "comments" && added.visibleToPeople === true, `${role}: comment visibility receipt missing`);
    for (const comments of [await call(token, "comments", "list", { task_id: id }), await rest(`/comments?task_id=${id}`, token)]) {
      requireThat(comments.comments?.some(row => row.id === added.comment.id && row.text.includes(text)), `${role}: comment readback missing content`);
    }
    const moved = await call(token, "tasks", "update", { task_id: id, section_id: board.columns[1].id });
    requireThat(moved.task?.id === id, `${role}: wrong move receipt`);
    for (const data of [await call(token, "tasks", "get", { task_id: [id] }), await rest(`/tasks?task_id=${id}`, token)]) {
      requireThat(taskRow(data, id, title).sectionId === board.columns[1].id, `${role}: move readback wrong column`);
    }
    const labels = await call(token, "labels", "list", { project_id: board.id });
    requireThat(labels.labels?.some(row => row.id === board.label.id && row.name === board.label.name), `${role}: seeded label missing`);
    const content = `${role} page content ${randomUUID()}`;
    const pageTitle = `${role} contract page`;
    const page = await call(token, "pages", "create", { task_id: id, title: pageTitle, content, content_type: "markdown" });
    requireThat(Number.isInteger(page.page?.id), `${role}: invalid page receipt`);
    for (const read of [await call(token, "pages", "get", { page_id: page.page.id }), await rest(`/pages/get?id=${page.page.id}&format=markdown`, token)]) {
      requireThat(read.page?.id === page.page.id && read.page.title === pageTitle && read.page.content?.includes(content), `${role}: page readback missing content`);
    }
    console.log(`${role}: initialize, catalog, boards, task, keyword search, writes/readbacks, labels and page passed`);
  }
  const readToken = tokens["read-agent"];
  await initialize(readToken, operations.filter(([family, action]) => descriptions[family].actions[action].read_only));
  taskRow(await call(readToken, "tasks", "get", { task_id: [board.task.id] }), board.task.id, board.task.title);
  const writeInput = { project_id: board.id, title: "Read agent must not write" };
  const denied = await rpcEnvelope(base, readToken, "tools/call", { name: descriptions.tasks.name,
    arguments: { action: "create", input: writeInput } });
  requireThat(denied.envelope?.id === denied.id && (denied.envelope.error || denied.envelope.result?.isError === true), "Read agent: MCP write was not refused");
  const restDenied = await requestLocal(base, "/api/mcp/tasks/create", { method: "POST", headers: { Authorization: `Bearer ${readToken}`, "Content-Type": "application/json" }, body: JSON.stringify(writeInput) });
  requireThat(restDenied.status === 403, "Read agent: REST write was not refused");
  const outsider = await requestLocal(base, `/api/mcp/tasks?task_id=${board.task.id}`, { headers: { Authorization: `Bearer ${tokens.unaccepted}` } });
  if (outsider.ok) {
    const data = await responseJson(outsider, "Unaccepted invite control");
    requireThat(Array.isArray(data.tasks) && !data.tasks.some(row => row.id === board.task.id), "Unaccepted invite: board access was allowed");
  } else requireThat([403, 404].includes(outsider.status), "Unaccepted invite: unexpected refusal status");
  console.log("Read agent read/write refusal and unaccepted invitation access controls passed");
  await cliContract(base, binary, tokens.owner, board, rest);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "contract=passed\n");
  console.log("MCP CLI API CONTRACT PASSED");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runContract().catch(error => {
    console.error(`MCP CLI API contract failed: ${error.contractAssertion ? error.message : "unexpected runner failure (details withheld)"}`);
    process.exitCode = 1;
  });
}
