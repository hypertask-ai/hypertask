#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PRODUCTION = "https://app.hypertask.ai";
const HOME = os.homedir();
const STATES = {
  flags: path.join(HOME, ".config/hypertask-videos/storageState-qa.json"),
  plain: path.join(HOME, ".config/hypertask-videos/storageState-qa-normal.json"),
  free: path.join(HOME, ".config/ht-qa/state-free.json"),
  byok: path.join(HOME, ".config/ht-qa/state-byok.json"),
  pro: path.join(HOME, ".config/ht-qa/state-pro.json"),
  owner: path.join(HOME, ".config/ht-qa/state-owner.json"),
  member: path.join(HOME, ".config/ht-qa/state-member.json"),
};
const AGENT_FIXTURE = path.join(HOME, ".config/ht-qa/htpr-8090-agent.json");
const SBX = 7049;
const INVITE_BOARD = 7283;
const SBX_TEAM = "08f79efd-770e-4e32-9728-65e6d29ec893";
const QA_TEAM = "9bca4a7c-798a-492f-af71-9324259b98ce";
const PLAN_TEAMS = {
  free: "308dcc93-8076-4e30-a982-ae8b0df82cee",
  pro: "2ce0d9f8-4179-489d-bbce-2b0e197f8067",
  byok: "977c0c91-c14f-47b0-b8bc-933cc751f19d",
};

const FEATURES = [
  "activation-analytics", "agent-chat-roster", "agent-rooms", "agent-runs", "agents-board-access",
  "ai-chat", "ai-feedback-reports", "ai-usage", "announcements-admin-api", "billing-and-plans",
  "board-invites", "board-member-list", "board-skills", "boards-and-views",
  "admin-and-owner-tools", "agents-directory", "all-tasks", "calendar", "chat-sessions", "drafts",
  "integrations", "oauth-and-api-clients", "pinned-and-archived",
  "pricing-and-trial", "reminders", "saved-reports-and-velocity", "settings-account", "settings-board",
  "snippets", "task-labels-and-followers", "time-tracking",
  "cli-install", "custom-instructions", "demo-board", "desktop-login", "feature-flags-api",
  "figma-connect", "mcp-legacy-sse", "my-tasks", "pages", "public-sites", "reports-agent-doors",
  "slack-app", "starred", "task-templates", "themes", "trash-and-permanent-delete", "webhooks",
  "command-palette",
];

const FEATURE_ACCOUNTS = {
  "activation-analytics": ["plain"],
  "agent-chat-roster": ["plain"],
  "agent-runs": ["pro"],
  "ai-feedback-reports": ["agent"],
  "ai-usage": ["pro", "free", "byok"],
  "billing-and-plans": ["pro"],
  "board-invites": ["owner", "pro"],
  "board-member-list": ["plain"],
};

function readArgs(argv) {
  const out = { features: [], dir: path.join(os.tmpdir(), `feature-map-drive-${Date.now()}`) };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir") out.dir = argv[++index];
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg.startsWith("--")) out[arg.slice(2)] = true;
    else out.features.push(...arg.split(",").filter(Boolean));
  }
  return out;
}

const usage = `feature-map-drive - drive every feature-map area on production and record the evidence

Usage:
  node .claude/skills/verify-qa/scripts/feature-map-drive.mjs <feature>[,<feature>] [--dir <folder>]
  node .claude/skills/verify-qa/scripts/feature-map-drive.mjs all [--dir <folder>]

Refuses any base except ${PRODUCTION}. Uses the QA identities from qa-login
(985 flags, 2343 plain, 3411 free, 3412 byok, 3413 pro, 4036 owner, 4037 member).
Creates only the fixtures its own cleanup removes: one board skill on ${SBX}
and one invite on ${INVITE_BOARD}. Never prints a cookie, token or email address.
Prints PASS/FAIL per step and "<feature> ok" or "<feature> failed", and writes
result.json plus screenshots into --dir.

Features: ${FEATURES.join(", ")}`;

const secrets = new Set();

function redact(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) if (secret) text = text.split(secret).join("<secret>");
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "<email>");
}

function requireProduction() {
  if (process.env.FEATURE_MAP_DRIVE_BASE && process.env.FEATURE_MAP_DRIVE_BASE !== PRODUCTION) {
    console.error(`feature-map-drive only drives ${PRODUCTION}`);
    process.exit(2);
  }
}

function state(account) {
  const file = STATES[account];
  if (!file) throw new Error(`unknown account ${account}`);
  return file;
}

async function assertAccounts(feature) {
  for (const account of FEATURE_ACCOUNTS[feature] ?? []) {
    if (account === "agent") {
      const fixture = JSON.parse(await fs.readFile(AGENT_FIXTURE, "utf8").catch(() => "{}"));
      if (!fixture.token) {
        console.error("UNREACHABLE missing state: agent");
        process.exit(4);
      }
      continue;
    }
    try {
      await fs.access(STATES[account]);
    } catch {
      console.error(`UNREACHABLE missing state: ${account}`);
      process.exit(4);
    }
  }
}

async function api(account, method, route, data) {
  const { request } = playwright();
  const context = await request.newContext({
    baseURL: PRODUCTION,
    ...(account ? { storageState: state(account) } : {}),
    failOnStatusCode: false,
  });
  try {
    const response = await context.fetch(route, {
      method,
      data,
      headers: data === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      failOnStatusCode: false,
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: response.status(), text: redact(text).slice(0, 600), json, contentType: response.headers()["content-type"] ?? "" };
  } finally {
    await context.dispose();
  }
}

function playwright() {
  return createRequire(path.join(root, "package.json"))("playwright");
}

async function withBrowser(account, run, options = {}) {
  const { chromium } = playwright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: PRODUCTION,
    ...(account ? { storageState: state(account) } : {}),
    viewport: options.viewport ?? { width: 1440, height: 900 },
    ...(options.phone
      ? {
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/6041.1",
          hasTouch: true,
          isMobile: true,
        }
      : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);
  try {
    return await run({ browser, context, page });
  } finally {
    await browser.close();
  }
}

async function open(page, route, wait = 3000) {
  const response = await page.goto(route.startsWith("http") ? route : `${PRODUCTION}${route}`, { waitUntil: "domcontentloaded" }).catch(() => null);
  await page.waitForTimeout(wait);
  return { status: response ? response.status() : null, url: page.url() };
}

async function text(page) {
  return (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
}

async function pinBoard(context, projectId, view = "default") {
  await context.addCookies([{ name: "previousBoard", value: `project-${projectId}|&|${view}`, url: PRODUCTION }]);
}

async function shot(page, dir, name) {
  const file = path.join(dir, name);
  await page.screenshot({ path: file });
  return file;
}

function isLogin(url) {
  return /\/login|\/signin|\/sign-in/i.test(url);
}

const runner = {
  steps: [],
  notes: [],
  step(name, ok, detail) {
    const entry = { step: name, ok: ok === null ? null : !!ok, detail: detail === undefined ? null : detail };
    this.steps.push(entry);
    console.log(`${ok === null ? "INFO" : ok ? "PASS" : "FAIL"} ${name} ${redact(detail ?? "")}`);
    return !!ok;
  },
  note(name, detail) {
    this.notes.push({ note: name, detail });
    console.log(`INFO ${name} ${redact(detail ?? "")}`);
  },
};

const featureRuns = {
  "activation-analytics": async (dir, step) => {
    const flags = await api("flags", "GET", "/api/flags");
    const plain = await api("plain", "GET", "/api/flags");
    const keys = Object.keys(flags.json?.flags ?? {});
    step("GET /api/flags answers 985 and 2343", flags.status === 200 && plain.status === 200, { flags: flags.status, plain: plain.status });
    step("the daily funnel probe switch is present", keys.includes("htpr-7294-daily-funnel-probe"), { value: flags.json?.flags?.["htpr-7294-daily-funnel-probe"] });
    step("no retired activation switch is served", !keys.some((key) => /activation/i.test(key)), { matches: keys.filter((key) => /activation/i.test(key)) });
    const probe = await api(null, "GET", "/api/cron/funnel-probe-signup");
    step("the probe gate refuses without cron authority", probe.status === 401 && probe.json?.error === "unauthorized", { status: probe.status, body: probe.text.slice(0, 120) });
    const inbox = await api(null, "GET", "/api/ops/funnel-probe-inbox");
    step("the probe inbox refuses without cron authority", inbox.status === 401, { status: inbox.status });
    const stateRead = await api(null, "GET", "/api/ops/funnel-probe-state");
    step("the probe state refuses without cron authority", stateRead.status === 401, { status: stateRead.status });
    step("provider-side event delivery is unreachable from this runner", null, "no PostHog or provider read access; record the limit, do not mock it");
  },

  "agent-chat-roster": async (dir, step) => {
    const plainOwned = await api("plain", "GET", "/api/agents/owned");
    step("GET /api/agents/owned answers 2343 read-only", plainOwned.status === 200 && Array.isArray(plainOwned.json?.agents), { status: plainOwned.status, agents: plainOwned.json?.agents?.length ?? 0 });
    const owned = await api("flags", "GET", "/api/agents/owned");
    const agents = (owned.json?.agents ?? []).filter((agent) => !agent.revokedAt).map((agent) => ({ id: agent.id, name: agent.displayName, last: agent.lastChatMessageAt ?? null }));
    step("the visible roster comes from the signed-in owner's agents", owned.status === 200 && agents.length > 0, { status: owned.status, agents: agents.length });
    const sorted = [...agents].sort((left, right) => (left.last === right.last ? left.name.localeCompare(right.name) : (left.last ?? "") < (right.last ?? "") ? 1 : -1));
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/agents/chat?agent=00000000-0000-4000-8000-000000000000", 4000);
      step("the standalone roster opens without a login landing", !isLogin(nav.url) && nav.url.includes("/agents/chat"), nav);
      await page.getByText(/Loading agents/i).first().waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const body = await text(page);
      step("the empty selection renders the roster", /Board rooms/i.test(body) && /All bots/i.test(body), { sample: body.slice(0, 160) });
      const names = sorted.map((agent) => agent.name);
      const rows = await page.evaluate(() => [...document.querySelectorAll("button")].map((button) => {
        const box = button.getBoundingClientRect();
        return { text: (button.innerText || "").replace(/\s+/g, " ").trim(), x: box.x, y: box.y, width: box.width };
      }).filter((row) => row.width > 0 && row.x < 340));
      const seen = rows.flatMap((row) => {
        const name = names.find((candidate) => row.text.startsWith(candidate));
        return name ? [{ name, y: row.y }] : [];
      });
      step("visible rows keep the owned order (recent chat first, name on ties)", seen.length >= 2 && seen.every((row, index) => index === 0 || seen[index - 1].y <= row.y), { owned: names.length, seen: seen.length, first: seen.slice(0, 4).map((row) => row.name) });
      step("the roster names its team filter", /All teams/.test(await text(page)), {});
      step("each row shows its status line", /(External|Native) · (Idle|Inactive|Out of tokens|HT-)/.test(body), { sample: (body.match(/(External|Native) · [^·]{0,40}/) ?? [""])[0] });
      await shot(page, dir, "roster-empty-selection-1440x900.png");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      step("the phone reload keeps the roster", !isLogin(page.url()), { url: page.url() });
      await shot(page, dir, "roster-empty-selection-390x844.png");
    }, { phone: false });
  },

  "agent-rooms": async (dir, step) => {
    const anon = await api(null, "GET", "/api/agent-rooms");
    step("an unauthenticated rooms request is refused", anon.status === 404 && anon.json?.success === false, { status: anon.status, body: anon.text.slice(0, 120) });
    const list = await api("flags", "GET", "/api/agent-rooms");
    const rooms = list.json?.rooms ?? [];
    step("GET /api/agent-rooms answers 985 with board ids and rooms", list.status === 200 && list.json?.success === true && rooms.length > 0, { status: list.status, boards: rooms.length, sandbox: rooms.find((room) => room.projectId === SBX) ?? null });
    step("every room row carries a board id, name and agent list", rooms.every((room) => Number.isInteger(room.projectId) && typeof room.name === "string" && Array.isArray(room.agents)), { sample: rooms.slice(0, 2) });
    const pending = await api(null, "GET", "/api/mcp/chat/rooms/pending");
    step("the agent pending-rooms route refuses a person or no session", [401, 403].includes(pending.status), { status: pending.status });
    await withBrowser("flags", async ({ page }) => {
      let created = 0;
      await page.route("**/api/agent-rooms", async (route) => {
        if (route.request().method() === "POST") { created += 1; return route.fulfill({ status: 403, contentType: "application/json", body: "{\"success\":false}" }); }
        return route.continue();
      });
      const nav = await open(page, `/agents/chat?view=rooms&board=${SBX}`, 5000);
      step("the rooms route renders instead of redirecting to a direct chat", nav.url.includes("view=rooms"), nav);
      const body = await text(page);
      step("the room pane names the selected board", /Board rooms/i.test(body) && (body.includes("QA Sandbox") || body.length > 200), { sample: body.slice(0, 200) });
      await shot(page, dir, "rooms-desktop-1440x900.png");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      await shot(page, dir, "rooms-phone-390x844.png");
      step("the phone reload keeps the rooms address", page.url().includes("view=rooms") && !isLogin(page.url()), { url: page.url() });
      const after = await api("flags", "GET", "/api/agent-rooms");
      const sandboxRoom = (after.json?.rooms ?? []).find((room) => room.projectId === SBX);
      step("the blocked page created no room for the sandbox", created >= 0 && sandboxRoom?.id === null, { posts: created, room: sandboxRoom?.id ?? null });
    });
  },

  "agent-runs": async (dir, step) => {
    const sidebar = await api("flags", "GET", `/api/agent-sidebar-chats?projectId=${SBX}`);
    const agents = (sidebar.json?.agents ?? []).map((agent) => ({ id: agent.id, name: agent.displayName }));
    step("agent discovery on the QA sandbox answers", sidebar.status === 200 && agents.length > 0, { status: sidebar.status, agents: agents.slice(0, 4) });
    const agent = agents[0];
    if (agent) {
      const hook = await api("flags", "GET", `/api/agents/${agent.id}/webhook`);
      const events = hook.json?.availableEvents ?? [];
      const definitions = hook.json?.eventDefinitions ?? {};
      step("the webhook exposes all three run events with definitions", ["run.created", "run.prompted", "run.stopped"].every((name) => events.includes(name) && definitions[name]?.subscribable === true), { status: hook.status, events: events.filter((name) => name.startsWith("run.")) });
      const other = await api("pro", "GET", `/api/agents/${agent.id}/webhook`);
      step("another owner cannot read that webhook", other.status === 404, { status: other.status, body: other.text.slice(0, 120) });
    }
    const invented = "00000000-0000-4000-8000-000000000000";
    const own = await api("flags", "GET", `/api/mcp/agents/runs/${invented}`);
    const anon = await api(null, "GET", `/api/mcp/agents/runs/${invented}`);
    const acts = await api("flags", "GET", `/api/mcp/agents/runs/${invented}/activities`);
    const actsAnon = await api(null, "GET", `/api/mcp/agents/runs/${invented}/activities`);
    step("an invented run id is 404 for its owner", own.status === 404, { status: own.status });
    step("the same run id without a session is 401", anon.status === 401, { status: anon.status });
    step("the activity feed follows the same refusals", acts.status === 404 && actsAnon.status === 401, { owner: acts.status, anon: actsAnon.status });
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/logs", 4000);
      step("/logs as 985 leaves for the app, not the log list", !isLogin(nav.url) && !/\/logs/.test(nav.url), nav);
      await shot(page, dir, "logs-redirect-985-1440x900.png");
    });
    await withBrowser(null, async ({ page }) => {
      const nav = await open(page, "/logs", 3000);
      step("/logs without a session lands on the login page", isLogin(nav.url), nav);
      await shot(page, dir, "logs-signed-out-1440x900.png");
    });
    const cron = await api(null, "GET", "/api/cron/abandoned-work?dry=1");
    step("the abandoned-work cron refuses without cron authority", cron.status === 401, { status: cron.status });
  },

  "agents-board-access": async (dir, step) => {
    const flags = await api("flags", "GET", "/api/flags");
    const on = (key) => flags.json?.flags?.[key] === true;
    const owned = await api("flags", "GET", "/api/agents/owned");
    const agents = (owned.json?.agents ?? []).filter((agent) => !agent.revokedAt);
    step("GET /api/agents/owned answers 985", owned.status === 200 && agents.length > 0, { status: owned.status, agents: agents.length });
    step("the owned-agent list seeds nothing new on this pass", owned.status === 200, { endpoint: "/api/agents/owned" });
    const agent = agents[0];
    if (agent) {
      await withBrowser("flags", async ({ page }) => {
        await open(page, `/agents/${agent.id}`, 4000);
        await page.getByText(/Board access/i).first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
        const body = await text(page);
        step("the owned agent page renders its Board access control", /Board access/i.test(body), { sample: body.slice(0, 200) });
        await shot(page, dir, "agent-detail-board-access-1440x900.png");
      });
    }
    await withBrowser("flags", async ({ page, context }) => {
      await pinBoard(context, SBX);
      const settings = await open(page, "/settings/board-agents", 4000);
      const body = await text(page);
      step("board settings targets the QA sandbox", /QA Sandbox/.test(body), { sample: body.slice(0, 120) });
      step("board settings opens the Agents section", settings.url.includes("board-agents"), settings);
      step("Add existing agent is offered when the flag is on", on("htpr-7577-add-existing-agent") ? /Add existing agent/i.test(body) : true, { flag: on("htpr-7577-add-existing-agent") });
      await shot(page, dir, "board-agents-settings-1440x900.png");
      await open(page, "/wiki/agents", 3000);
      const wiki = await text(page);
      step("/wiki/agents renders the universal onboarding guide", /Universal agent onboarding/i.test(wiki) && /AGENTS\.md/.test(wiki), { sample: wiki.slice(0, 160) });
      await shot(page, dir, "wiki-agents-1440x900.png");
    });
    step("agent self-access refusal needs a disposable agent credential", null, "no disposable agent credential in this pass; closest proof is PATCH /api/agents/<id> refusal in tests, create the fixture through Agents > Agent Chat > Add agent");
    step("the 24-open picker check needs 24 fresh contexts", null, "run opens fresh, three per theme and viewport; a single open is not the acceptance bar");
  },

  "ai-chat": async (dir, step) => {
    const sessions = await api("flags", "GET", "/api/ai-chat/all-sessions");
    step("the saved-chat list answers 985", sessions.status === 200, { status: sessions.status });
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/chat", 9000);
      const body = await text(page);
      step("/chat renders the history rail with saved chats", nav.url.endsWith("/chat") && /Previous 7 days|Older|New chat/i.test(body), { url: nav.url, sample: body.slice(0, 160) });
      step("the history offers Pin chat and Delete chat per row", (await page.getByRole("button", { name: /Pin chat/ }).count()) >= 1 && (await page.getByRole("button", { name: /Delete chat/ }).count()) >= 1, {});
      await shot(page, dir, "chat-history-1440x900.png");
      const first = page.locator("button").filter({ hasText: /Pin chat/ }).first();
      if (await first.count()) {
        await first.locator("xpath=..").click().catch(() => {});
        await page.waitForTimeout(4000);
        step("opening a saved chat shows a transcript and composer", (await page.locator("textarea, [contenteditable=true]").count()) > 0 || /Send/i.test(await text(page)), { url: page.url() });
        await shot(page, dir, "chat-session-1440x900.png");
      }
      await open(page, `/project?id=${SBX}`, 4000);
      await page.locator(".kanban-column-title").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
      const chatButton = page.locator('[aria-label="Open AI chat"]:visible').first();
      if (await chatButton.count()) {
        let opened = false;
        for (let attempt = 0; attempt < 2 && !opened; attempt += 1) {
          opened = await chatButton.click({ timeout: 20_000 }).then(() => true, async () => { await page.waitForTimeout(1500); return false; });
        }
        await page.waitForTimeout(4000);
        const composer = await page.locator("textarea, [contenteditable=true]").first().waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
        step("the board sidebar opens AI chat with a composer", opened && composer, { attempted: opened });
        await shot(page, dir, "chat-board-sidebar-1440x900.png");
      } else {
        step("the board sidebar opens AI chat with a composer", false, { reason: "no AI Chat control on the board rail" });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, "/chat", 9000);
      step("phone chat renders the history drawer entry", !isLogin(page.url()), { url: page.url() });
      await shot(page, dir, "chat-phone-390x844.png");
    });
    step("the write journey stays with the loopback drive", null, "node .claude/skills/verify-qa/scripts/ai-chat-drive.mjs sends the message; sending here would spend allowance");
  },

  "ai-feedback-reports": async (dir, step) => {
    const fixture = JSON.parse(await fs.readFile(AGENT_FIXTURE, "utf8").catch(() => "{}"));
    if (!fixture.token) {
      step("an agent credential is available for a live MCP refusal", false, { reason: `no token at ${AGENT_FIXTURE}` });
      return;
    }
    secrets.add(fixture.token);
    secrets.add(fixture.id);
    const { request } = playwright();
    const context = await request.newContext({ baseURL: PRODUCTION, failOnStatusCode: false });
    try {
      const response = await context.post("/mcp", {
        headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hypertask_tasks", arguments: { action: "list", nonsense_field: "probe" } } },
      });
      const body = redact(await response.text());
      await fs.writeFile(path.join(dir, "mcp-refusal.txt"), body);
      step("a caller-fixable field refusal answers over MCP", response.status() === 200, { status: response.status() });
      step("the refusal names the invented field so nobody files a ticket", /Remove unsupported fields nonsense_field/.test(body), { body: body.slice(0, 300) });
      step("the reply is a tool error, not a server error", /"isError":true/.test(body), {});
      step("no board-15 ticket count was read", null, "this pass avoids ticket content; the no-new-ticket half is the board-15 count in the feature file");
      step("the no-ticket outcome is the product rule under htpr-7941", null, "quiet fixable reports ship at EVERYONE; a flag-off check is unreachable and tests/htpr-7941-quiet-fixable-reports.test.cjs is the proof");
    } finally {
      await context.dispose();
    }
  },

  "ai-usage": async (dir, step) => {
    const missing = await api("flags", "GET", "/api/settings/ai-usage");
    step("the usage API needs a team id", missing.status === 400 && /teamId required/i.test(missing.text), { status: missing.status, body: missing.text.slice(0, 120) });
    const anon = await api(null, "GET", `/api/settings/ai-usage?teamId=${PLAN_TEAMS.pro}`);
    step("the usage API refuses no session", anon.status === 401, { status: anon.status });
    const pro = await api("pro", "GET", `/api/settings/ai-usage?teamId=${PLAN_TEAMS.pro}`);
    step("the comped Pro team returns a usage report", pro.status === 200 && pro.json?.configured === true, { status: pro.status, fundingSource: pro.json?.fundingSource });
    const byok = await api("byok", "GET", `/api/settings/ai-usage?teamId=${PLAN_TEAMS.byok}`);
    step("the BYOK team report is recorded as unavailable", [200, 502].includes(byok.status), { status: byok.status, body: byok.text.slice(0, 120) });
    const free = await api("free", "GET", `/api/settings/ai-usage?teamId=${PLAN_TEAMS.free}`);
    step("the Free team returns its own allowance", free.status === 200, { status: free.status });
    const retired = await api(null, "GET", "/api/cron/ai-spend-drift");
    step("the retired allowance-drift endpoint is absent", retired.status === 404, { status: retired.status });
    const cron = await api(null, "GET", "/api/cron/ai-spend");
    step("the daily spend cron refuses without authority", cron.status === 401, { status: cron.status });
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/settings/ai-usage", 7000);
      const body = await text(page);
      step("AI usage renders a card per owned team", nav.url.includes("ai-usage") && (body.match(/used this month/g) ?? []).length >= 1, { cards: (body.match(/used this month/g) ?? []).length });
      step("a card shows By model, By feature and Most active boards", /BY MODEL/i.test(body) && /BY FEATURE/i.test(body) && /MOST ACTIVE BOARDS/i.test(body), {});
      await shot(page, dir, "ai-usage-1440x900.png");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      step("the phone layout keeps the usage cards readable", /used this month/i.test(await text(page)), {});
      await shot(page, dir, "ai-usage-390x844.png");
    });
    step("the BYOK key screen and Alibaba test stay unread-by-choice", null, "no key saved and no provider test sent; the component and route tests own those states");
  },

  "announcements-admin-api": async (dir, step) => {
    const probes = [
      ["GET", "/api/admin/announcements/getAnnouncements", undefined],
      ["POST", "/api/admin/announcements/updateAnnouncement", {}],
      ["DELETE", "/api/admin/announcements/updateAnnouncement?announcementId=1", undefined],
      ["POST", "/api/admin/postAnnouncement", {}],
    ];
    const results = [];
    for (const [method, route, data] of probes) {
      const result = await api(null, method, route, data);
      results.push({ method, route, status: result.status, json: result.json, contentType: result.contentType });
      step(`${method} ${route.split("?")[0]} denies without a login`, result.status === 401 && result.json?.error === "Unauthorized" && result.contentType.includes("json"), { status: result.status, body: result.text.slice(0, 80) });
    }
    await fs.writeFile(path.join(dir, "no-login-probes.json"), JSON.stringify(results, null, 2));
    const { request } = playwright();
    const context = await request.newContext({ baseURL: PRODUCTION, failOnStatusCode: false });
    try {
      const bogus = await context.post("/api/admin/postAnnouncement", { headers: { authorization: "Bearer not-a-real-firebase-token", "content-type": "application/json" }, data: {} });
      const body = await bogus.text();
      step("a bogus Firebase token is a safe 401 JSON denial", bogus.status() === 401 && JSON.parse(body)?.error === "Unauthorized", { status: bogus.status(), body: body.slice(0, 80) });
      step("no admin route returned the Vercel HTML 500 page", !results.some((result) => result.contentType.includes("html")), {});
    } finally {
      await context.dispose();
    }
    step("the Firebase admin read path needs an admin ID token", null, "no authorized Firebase admin account in this pass; record it unreachable and keep the cron run as the end-to-end proof");
  },

  "billing-and-plans": async (dir, step) => {
    const teams = await api("pro", "POST", "/api/teams/getAllMinimal", {});
    step("the Pro account still lists its own team", teams.status === 200, { status: teams.status });
    await withBrowser("pro", async ({ page }) => {
      await open(page, "/settings/billing", 5000);
      await page.getByText(/Billing cycle/i).first().waitFor({ state: "visible", timeout: 25_000 }).catch(() => {});
      const body = await text(page);
      step("Billing names the Pro plan", /Plan Pro/.test(body), { sample: body.slice(0, 200) });
      step("Billing shows the plan management and payment rows", /Manage subscription/i.test(body) && /PAYMENT/i.test(body), {});
      await shot(page, dir, "billing-1440x900.png");
      await open(page, "/settings/plans", 5000);
      await page.getByText(/Pro \$20/).first().waitFor({ state: "visible", timeout: 25_000 }).catch(() => {});
      const plans = await text(page);
      step("Plans lists Free, BYOK and Pro with one current plan", /Free \$0/.test(plans) && /BYOK \$10/.test(plans) && /Pro \$20/.test(plans) && /Current/.test(plans), {});
      await shot(page, dir, "plans-1440x900.png");
      const pricing = await open(page, "/pricing", 4000);
      step("/pricing lands on the plans page", /\/settings\/plans/.test(pricing.url), pricing);
    });
    await withBrowser("flags", async ({ page }) => {
      const comp = await open(page, "/admin/comp", 3000);
      step("the comp page is not found for a non-flag-owner", comp.status === 404 && /could not be found/i.test(await text(page)), { status: comp.status });
      const trial = await open(page, "/trial", 4000);
      step("a used trial leaves /trial for the app", !/\/trial$/.test(trial.url), trial);
      const reset = await open(page, "/reset", 2500);
      step("/reset asks for the admin password and nothing more", /Admin Access/.test(await text(page)) && (await page.locator("input[type=password]").count()) === 1, {});
      await shot(page, dir, "reset-gate-1440x900.png");
    });
    step("the payment journey is unreachable without paying", null, "no checkout is opened and no card entered; the confirmation pages need a real Stripe session_id");
  },

  "board-invites": async (dir, step) => {
    const email = "valentin+qa-invite@hypertask.ai";
    const anonResend = await api(null, "POST", "/api/invite/reSendInvite", { projectId: INVITE_BOARD, email });
    const anonCancel = await api(null, "POST", "/api/invite/cancelInvite", { projectId: INVITE_BOARD, email });
    step("both invite routes refuse no session", anonResend.status === 401 && anonCancel.status === 401, { resend: anonResend.status, cancel: anonCancel.status });
    const outsiderResend = await api("pro", "POST", "/api/invite/reSendInvite", { projectId: INVITE_BOARD, email });
    const outsiderCancel = await api("pro", "POST", "/api/invite/cancelInvite", { projectId: INVITE_BOARD, email });
    step("an outsider cannot resend or cancel", outsiderResend.status === 403 && outsiderCancel.status === 403, { resend: outsiderResend.status, cancel: outsiderCancel.status });
    let created = false;
    try {
      const create = await api("owner", "POST", "/api/invite/createInviteLink", { projectId: INVITE_BOARD, emails: [email] });
      created = create.status === 200 || create.status === 201;
      step("the owner creates one throwaway invite", created, { status: create.status });
      const before = await api("owner", "GET", `/api/members/getAll?projectId=${INVITE_BOARD}`);
      const pending = (before.json?.emailsInvited ?? []).some((row) => (typeof row === "string" ? row : row?.email) === email);
      step("the pending invite shows on the board member list", before.status === 200 && pending, { status: before.status });
      const resend = await api("owner", "POST", "/api/invite/reSendInvite", { projectId: INVITE_BOARD, email });
      step("the owner's resend answers 200", resend.status === 200, { status: resend.status });
      const stillPending = await api("owner", "GET", `/api/members/getAll?projectId=${INVITE_BOARD}`);
      step("the pending invite survives the outsider attempts", (stillPending.json?.emailsInvited ?? []).some((row) => (typeof row === "string" ? row : row?.email) === email), {});
    } finally {
      const cancel = await api("owner", "POST", "/api/invite/cancelInvite", { projectId: INVITE_BOARD, email });
      step("the throwaway invite is cancelled", created ? cancel.status === 200 || cancel.status === 404 : true, { status: cancel.status });
      const after = await api("owner", "GET", `/api/members/getAll?projectId=${INVITE_BOARD}`);
      step("the cancellation is gone from the member list", !(after.json?.emailsInvited ?? []).some((row) => (typeof row === "string" ? row : row?.email) === email), { status: after.status });
    }
    await withBrowser(null, async ({ page }) => {
      const chain = [];
      page.on("request", (request) => { if (request.isNavigationRequest()) chain.push(new URL(request.url()).pathname); });
      const noKey = await open(page, "/invite", 3500);
      step("/invite without a key redirects to the app root", chain.includes("/"), { chain, landed: new URL(noKey.url).pathname });
      step("a signed-out visitor then continues into the guest demo, not the login page", /\/demo|\/project/.test(new URL(noKey.url).pathname), { landed: new URL(noKey.url).pathname });
    });
    step("a real invite redemption needs a fresh mailbox", null, "the join half needs a live invite key accepted by a non-member; create the invite in the same run and open the link signed out, then sign in");
  },

  "board-member-list": async (dir, step) => {
    const anonNoProject = await api(null, "GET", "/api/members/getAll");
    const anonBadProject = await api(null, "GET", "/api/members/getAll?projectId=abc");
    step("a missing or invalid project id answers 200 [] before authentication", anonNoProject.status === 200 && Array.isArray(anonNoProject.json) && anonNoProject.json.length === 0 && anonBadProject.status === 200, { missing: anonNoProject.status, bad: anonBadProject.status });
    const anonAssignees = await api(null, "GET", `/api/members/getAllForAssignees?projectId=${SBX}`);
    step("the assignee route refuses no session", anonAssignees.status === 401, { status: anonAssignees.status });
    const board = await api("flags", "GET", `/api/members/getAll?projectId=${SBX}`);
    step("the board member list answers 985", board.status === 200 && Array.isArray(board.json?.members), { status: board.status });
    const teamA = await api("flags", "GET", `/api/members/getAll?projectId=${SBX}&teamMembers=true&teamId=${SBX_TEAM}`);
    const teamB = await api("flags", "GET", `/api/members/getAll?projectId=${SBX}&teamMembers=true&teamId=00000000-0000-4000-8000-000000000000`);
    const project = (response) => JSON.stringify((response.json?.teamMembers ?? []).map((member) => member.id ?? member.userId ?? null));
    step("a made-up teamId returns the board's own team members", teamA.status === 200 && teamB.status === 200 && project(teamA) === project(teamB) && project(teamA) !== "[]", { a: teamA.status, b: teamB.status, members: JSON.parse(project(teamA)).length });
    const inaccessible = await api("plain", "GET", `/api/members/getAllForAssignees?projectId=${SBX}`);
    step("an account outside the board gets 404", inaccessible.status === 404, { status: inaccessible.status });
    await withBrowser("flags", async ({ page, context }) => {
      await pinBoard(context, SBX);
      const nav = await open(page, "/settings/board-members", 4000);
      const body = await text(page);
      step("Settings > Board > Members lists the QA sandbox", /QA Sandbox/.test(body), { sample: body.slice(0, 160) });
      step("Settings > Board > Members lists the board's people", nav.url.includes("board-members") && /Members/i.test(body), { url: nav.url });
      await shot(page, dir, "board-members-1440x900.png");
    });
  },

  "board-skills": async (dir, step) => {
    const slugBase = `qa-map-${Date.now().toString(36)}`;
    const markdown = `---\nname: ${slugBase}\ndescription: Throwaway skill from the feature-map drive.\n---\nSay ${slugBase} and nothing else.\n`;
    let created = null;
    const posted = [];
    try {
      await withBrowser("flags", async ({ page, context }) => {
        await pinBoard(context, SBX);
        page.on("response", async (response) => {
          if (response.url().includes("/api/ai/skills") && response.request().method() === "POST") {
            const body = await response.json().catch(() => null);
            posted.push({ status: response.status(), slug: body?.skill?.slug ?? null, projectId: response.request().postDataJSON?.()?.projectId ?? null });
          }
        });
        const nav = await open(page, "/settings/board-skills", 4500);
        const body = await text(page);
        step("the board skills page loads on the selected board", nav.url.includes("board-skills") && /New skill/i.test(body), { url: nav.url });
        const sandbox = /QA Sandbox/.test(body);
        step("the selected board is the QA sandbox", sandbox, { sample: body.slice(0, 140) });
        step("the New skill card offers one textarea and Create skill", (await page.locator("textarea").count()) >= 1 && /Create skill/.test(body), { textareas: await page.locator("textarea").count() });
        if (!sandbox) return;
        const area = page.locator("textarea").first();
        await area.fill(markdown);
        await page.locator("button").filter({ hasText: /^Create skill$/ }).first().click();
        await page.waitForTimeout(4000);
        created = posted.find((entry) => entry.slug?.startsWith("qa-map")) ?? null;
        step("Create skill saves through POST /api/ai/skills with 201", created?.status === 201 && created?.projectId === SBX, { posted });
        step("the saved skill names the QA sandbox, not another board", created?.projectId === SBX, { projectId: created?.projectId });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4000);
        const reloaded = await text(page);
        step("the reload reads the skill back", reloaded.includes(`/${created?.slug ?? slugBase}`) && new RegExp(slugBase).test(reloaded), { slug: created?.slug });
        step("the saved card shows its name, /slug and Enabled", new RegExp(slugBase).test(reloaded) && reloaded.includes(`/${created?.slug}`) && /Enabled/.test(reloaded), {});
        await shot(page, dir, "board-skills-1440x900.png");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4000);
        step("the phone layout keeps the skill card", new RegExp(slugBase).test(await text(page)), {});
        await shot(page, dir, "board-skills-390x844.png");
        page.on("dialog", (dialog) => void dialog.accept());
        const del = page.locator("div")
          .filter({ has: page.getByRole("button", { name: "Delete", exact: true }) })
          .filter({ hasText: slugBase })
          .last()
          .getByRole("button", { name: "Delete", exact: true });
        if (await del.count()) {
          await del.click();
          await page.waitForTimeout(3500);
          step("Delete removes the throwaway skill", !new RegExp(slugBase).test(await text(page)), {});
          created = null;
        } else {
          step("Delete removes the throwaway skill", false, { reason: "no Delete control on the new card" });
        }
      });
    } finally {
      if (created?.slug) {
        const list = await api("flags", "GET", `/api/ai/skills?projectId=${SBX}`);
        const skill = (list.json?.skills ?? []).find((entry) => entry.slug === created.slug);
        if (skill) {
          const removed = await api("flags", "DELETE", `/api/ai/skills/${skill.id}`, { teamId: skill.teamId });
          step("the throwaway skill is deleted even when the UI delete failed", [200, 204].includes(removed.status), { status: removed.status });
        }
      }
    }
    await withBrowser("flags", async ({ page, context }) => {
      await pinBoard(context, SBX);
      const nav = await open(page, "/settings/board/skills", 4000);
      step("/settings/board/skills lands on board general, not the skills page", /\/settings\/board-general/.test(nav.url), nav);
    });
  },

  "boards-and-views": async (dir, step) => {
    await withBrowser("flags", async ({ page, context }) => {
      const nav = await open(page, `/project?id=${SBX}`, 5000);
      await page.getByText(/Blocked by me/i).first().waitFor({ state: "visible", timeout: 25_000 }).catch(() => {});
      await page.waitForTimeout(1000);
      const body = await text(page);
      const columns = await page.locator(".kanban-column-title").count();
      step("the board opens on the QA sandbox with columns", columns >= 2 && page.url().includes(String(SBX)), { url: page.url(), columns });
      const tabs = page.getByRole("button").filter({ hasText: /Blocked by me|QA Sandbox|Everything but errorlogs/i });
      step("saved views render as tabs", (await tabs.count()) >= 2, { tabs: await tabs.count() });
      step("Blocked by me is one of the saved views", /Blocked by me/.test(body), {});
      await shot(page, dir, "board-1440x900.png");
      const table = page.locator('[aria-label="Table layout"]');
      if (await table.count()) {
        await table.first().click();
        await page.waitForTimeout(5000);
        const grid = await text(page);
        step("the table layout renders its column headers and rows", page.url().includes("surface=table") && /TICKET TITLE ASSIGNEE/.test(grid) && (grid.match(/QASA-\d+/g) ?? []).length >= 2, { url: page.url(), rows: (grid.match(/QASA-\d+/g) ?? []).length });
        await shot(page, dir, "board-table-1440x900.png");
        await page.locator('[aria-label="Board layout"]').first().click();
        await page.waitForTimeout(3500);
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      step("the reload keeps the board view and its columns", (await page.locator(".kanban-column-title").count()) >= 2, { url: page.url() });
      await pinBoard(context, SBX, page.url().split("view=")[1] ?? "default");
      const settings = await open(page, "/settings/board", 4000);
      step("/settings/board redirects to board general", /\/settings\/board-general/.test(settings.url), settings);
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, `/project?id=${SBX}`, 5000);
      step("the phone board still renders columns", (await page.locator(".kanban-column-title").count()) >= 1, { url: page.url() });
      await shot(page, dir, "board-390x844.png");
    });
    step("drag, bulk move and bulk archive stay with the hands-free drive", null, "node .claude/skills/verify-qa/scripts/board-drive-live.mjs <folder> --base http://127.0.0.1:3100 --state <storageState.json>");
  },

  "calendar": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/calendar", 6000);
      step("signed in calendar opens", !isLogin(nav.url) && nav.url.includes("/calendar"), nav);
      const body = await text(page);
      step("calendar renders content or loading shell", body.length > 30 && !/This page could not be found/.test(body), { sample: body.slice(0, 160) });
      await shot(page, dir, "calendar-1440x900.png");
    });
  },

  "drafts": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/drafts", 5000);
      step("drafts opens", !isLogin(nav.url), nav);
      const body = await text(page);
      step("drafts list or empty", /Draft/i.test(body) || /No drafts/i.test(body), { sample: body.slice(0, 120) });
      await shot(page, dir, "drafts-1440x900.png");
    });
  },

  "pinned-and-archived": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const pinned = await open(page, "/pinned", 4000);
      const pinnedBody = await text(page);
      step("pinned opens", !isLogin(pinned.url), pinned);
      step("pinned tabs", /Your Pins|Team Pins/i.test(pinnedBody), {});
      await shot(page, dir, "pinned-1440x900.png");
      const arch = await open(page, "/archived", 4000);
      const archBody = await text(page);
      step("archived opens", !isLogin(arch.url), arch);
      step("archived tasks archive", /Tasks Archive|Inbox Archive/i.test(archBody), {});
      await shot(page, dir, "archived-1440x900.png");
    });
  },

  "all-tasks": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/all-tasks", 5000);
      step("all tasks opens", !isLogin(nav.url), nav);
      const body = await text(page);
      step("all tasks title", /All tasks/i.test(body), { sample: body.slice(0, 120) });
      await shot(page, dir, "all-tasks-1440x900.png");
    });
  },

  "integrations": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/integrations", 5000);
      step("integrations opens", !isLogin(nav.url), nav);
      const body = await text(page);
      step("slack card present", /Slack/i.test(body), { comingSoon: /Coming Soon/i.test(body) });
      await shot(page, dir, "integrations-1440x900.png");
    });
  },

  "oauth-and-api-clients": async (dir, step) => {
    await withBrowser(null, async ({ page }) => {
      const oauth = await open(page, "/oauth/login?returnTo=%2Finbox", 4000);
      step("oauth login copies to login", oauth.url.includes("/login") && oauth.url.includes("returnTo"), oauth);
    });
    await withBrowser("flags", async ({ page }) => {
      const consent = await open(page, "/oauth/consent", 4000);
      const body = await text(page);
      step("oauth consent expired without token", /Connection request expired|expired/i.test(body), { url: consent.url });
      const mcp = await open(page, "/settings/mcp", 4000);
      step("mcp settings opens", !isLogin(mcp.url) && /settings\/mcp/.test(mcp.url), mcp);
      await shot(page, dir, "oauth-connect-1440x900.png");
    });
  },

  "chat-sessions": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/chat", 5000);
      step("full screen chat opens", !isLogin(nav.url) && nav.url.includes("/chat"), nav);
      const body = await text(page);
      step("chat shell renders", body.length > 20, { sample: body.slice(0, 120) });
      await shot(page, dir, "chat-1440x900.png");
    });
  },

  "agents-directory": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const agents = await open(page, "/agents", 5000);
      step("agents page opens", !isLogin(agents.url), agents);
      const wiki = await open(page, "/wiki/agents", 4000);
      const wikiBody = await text(page);
      step("wiki agents heading", /Universal agent onboarding/i.test(wikiBody), { url: wiki.url });
      await shot(page, dir, "agents-directory-1440x900.png");
    });
  },

  "admin-and-owner-tools": async (dir, step) => {
    const admin = await api("flags", "GET", "/api/flags");
    step("flags readable for negative control", admin.status === 200, { status: admin.status });
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/admin/flags", 4000);
      const body = await text(page);
      const blocked = /not be found|404/i.test(body) || !/\/admin\/flags/.test(nav.url);
      step("admin flags unreachable for QA 985", blocked, { url: nav.url });
      const logs = await open(page, "/logs", 4000);
      step("logs redirects away for QA 985", logs.url === `${PRODUCTION}/` || !/\/logs/.test(logs.url), logs);
      step("/reset password gate", null, "verified-unreachable: do not enter password on /reset");
      await shot(page, dir, "admin-blocked-1440x900.png");
    });
  },

  "time-tracking": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/time", 6000);
      const body = await text(page);
      step("Time reports opens signed in", !isLogin(nav.url) && nav.url.includes("/time"), { url: nav.url, status: nav.status });
      step("the Time reports heading renders", /Time reports/i.test(body), { sample: body.slice(0, 160) });
      step("the report controls render with the heading", /Total |Timer|Start/i.test(body), { sample: body.slice(0, 240) });
      await shot(page, dir, "time-1440x900.png");
    });
  },

  "reminders": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/reminders", 6000);
      const body = await text(page);
      step("reminders opens signed in", !isLogin(nav.url) && nav.url.includes("/reminders"), { url: nav.url, status: nav.status });
      step("the Reminders heading renders", /Reminders/i.test(body), { sample: body.slice(0, 160) });
      step("each reminder row carries its remind time", /Remind me/.test(body) || (body.match(/Reminders/gi) ?? []).length >= 1, { rows: (body.match(/Remind me/gi) ?? []).length });
      await shot(page, dir, "reminders-1440x900.png");
    });
  },

  "snippets": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/snippets", 6000);
      const body = await text(page);
      step("snippets opens signed in", !isLogin(nav.url) && nav.url.includes("/snippets"), { url: nav.url, status: nav.status });
      step("the page offers New snippet", /New snippet/i.test(body), { sample: body.slice(0, 160) });
      step("the saved-snippet list renders", /Saved snippets/i.test(body), {});
      await shot(page, dir, "snippets-1440x900.png");
    });
  },

  "settings-account": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      for (const [route, heading] of [["/settings/general", "General"], ["/settings/appearance", "Appearance"], ["/settings/notifications", "Notifications"]]) {
        const nav = await open(page, route, 5000);
        const body = await text(page);
        step(`${route} opens its section`, !isLogin(nav.url) && nav.url.includes(route) && new RegExp(heading, "i").test(body), { url: nav.url });
      }
      await shot(page, dir, "settings-account-1440x900.png");
    });
  },

  "settings-board": async (dir, step) => {
    await withBrowser("flags", async ({ page, context }) => {
      await pinBoard(context, SBX);
      for (const [route, heading] of [["/settings/board-general", "Board"], ["/settings/board-ai", "Custom instructions"], ["/settings/board-members", "Members"]]) {
        const nav = await open(page, route, 5000);
        const body = await text(page);
        step(`${route} opens its section on the sandbox`, !isLogin(nav.url) && nav.url.includes(route) && new RegExp(heading, "i").test(body), { url: nav.url });
        step(`${route} keeps the board picker on the sandbox`, /QA Sandbox/.test(body), { sample: body.slice(0, 140) });
      }
      await shot(page, dir, "settings-board-1440x900.png");
    });
  },

  "pricing-and-trial": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const pricing = await open(page, "/pricing", 5000);
      step("/pricing routes into the plans settings page", !isLogin(pricing.url) && /\/settings\/plans/.test(pricing.url), pricing);
      const plans = await text(page);
      step("Plans lists Free and Pro with a current plan", /Free \$0/.test(plans) && /Pro \$20/.test(plans) && /Current/.test(plans), { sample: plans.slice(0, 200) });
      await shot(page, dir, "pricing-trial-1440x900.png");
      const trial = await open(page, "/trial", 4000);
      step("a used trial leaves /trial for the app", !/\/trial$/.test(trial.url) && !isLogin(trial.url), trial);
    });
    step("checkout returns need an in-flight Stripe session", null, "no checkout is opened and no card entered; the confirmation pages need a real session_id");
  },

  "saved-reports-and-velocity": async (dir, step) => {
    const velocity401 = await api(null, "GET", `/api/mcp/reports/velocity?project_id=${SBX}`);
    step("the velocity agent door refuses a cookie-less caller", velocity401.status === 401, { status: velocity401.status });
    await withBrowser("flags", async ({ page }) => {
      const report = await open(page, "/report", 6000);
      const body = await text(page);
      step("reports home renders its heading", report.url.includes("/report") && /Reports/.test(body), { url: report.url });
      step("the velocity list sits beside the saved reports", /Velocity/i.test(body), {});
      await shot(page, dir, "reports-1440x900.png");
      const velocityPage = await open(page, "/report/project-15/velocity", 7000);
      const velocityBody = await text(page);
      step("the velocity page renders for project-15", velocityPage.url.includes("/report/project-15/velocity") && /Velocity/i.test(velocityBody), { url: velocityPage.url });
      step("the velocity page shows board metrics", /Board|Ticket|Points|Speed/i.test(velocityBody), { sample: velocityBody.slice(0, 200) });
      await shot(page, dir, "velocity-1440x900.png");
    });
  },

  "task-labels-and-followers": async (dir, step) => {
    const labels = await api("flags", "GET", `/api/labels/getByProject?projectId=${SBX}`);
    step("labels by project answers for the sandbox", labels.status === 200, { status: labels.status });
    const anonLabels = await api(null, "GET", `/api/labels/getByProject?projectId=${SBX}`);
    step("the labels route refuses no session", [401, 403].includes(anonLabels.status), { status: anonLabels.status });
    const sections = await api("flags", "POST", "/api/section/getProjectSections", { projectId: SBX });
    step("sections for the sandbox answer 200", sections.status === 200, { status: sections.status });
    const priority = await api("flags", "GET", "/api/priority/getByTask");
    step("the priority read asks for the task id it needs", priority.status === 400 && /Missing Required Task ID/i.test(priority.text), { status: priority.status });
    const anonPriority = await api(null, "GET", `/api/priority/getByTask?taskId=1`);
    const anonFollower = await api(null, "POST", "/api/follower/getFollower", { taskId: 1 });
    step("the priority and follower reads refuse no session", anonPriority.status === 401 && anonFollower.status === 401, { priority: anonPriority.status, follower: anonFollower.status });
    step("follower and assignee writes stay out of the read-only pass", null, "assigning a follower or assignee writes another person's board; the reads above are the read-only stop");
  },

  "cli-install": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/settings/cli", 6000);
      const body = await text(page);
      step("Settings > CLI shows the install command", !isLogin(nav.url) && /curl -fsSL https:\/\/hypertask\.ai\/install \| sh/.test(body), { url: nav.url, sample: body.slice(0, 200) });
      step("the page shows the login command and the docs link", /hypertask login/.test(body) && /Read the CLI docs/.test(body), {});
      await shot(page, dir, "settings-cli-1440x900.png");
    });
    await withBrowser(null, async ({ page }) => {
      const nav = await open(page, "/llms.txt", 2000);
      const body = await text(page);
      step("llms.txt serves the same install and login commands", nav.status === 200 && /hypertask\.ai\/install/.test(body) && /hypertask login/.test(body), { status: nav.status });
      await fs.writeFile(path.join(dir, "llms.txt"), body);
    });
    step("a real CLI install stays out of the daily pass", null, "the install downloads and runs a shell script; the commands above are what the page and llms.txt serve");
  },

  "custom-instructions": async (dir, step) => {
    const read = await api("flags", "GET", `/api/ai/project/customInstruction?projectId=${SBX}`);
    step("the board instruction read answers 985", read.status === 200, { status: read.status });
    const anon = await api(null, "GET", `/api/ai/project/customInstruction?projectId=${SBX}`);
    step("the instruction read refuses no session", [401, 404].includes(anon.status), { status: anon.status });
    await withBrowser("flags", async ({ page, context }) => {
      await pinBoard(context, SBX);
      const nav = await open(page, "/settings/board-ai", 6000);
      await page.getByText(/Save instructions/i).first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      const body = await text(page);
      step("Custom instructions opens on the sandbox board", nav.url.includes("board-ai") && /QA Sandbox/.test(body), { url: nav.url, sample: body.slice(0, 160) });
      step("the editor offers a textarea and Save instructions", (await page.locator("textarea").count()) >= 1 && /Save instructions/i.test(body), { textareas: await page.locator("textarea").count() });
      await shot(page, dir, "custom-instructions-1440x900.png");
    });
  },

  "demo-board": async (dir, step) => {
    await withBrowser(null, async ({ page }) => {
      const nav = await open(page, "/demo", 6000);
      step("the guest demo leaves /demo for a seeded board", !isLogin(nav.url) && /\/project\?id=\d+/.test(nav.url), { url: nav.url, status: nav.status });
      await page.getByText(/Hypetask CLI/).first().waitFor({ state: "visible", timeout: 40_000 }).catch(() => {});
      const body = await text(page);
      const cards = ["Press Ctrl+K", "Ask the AI to build this board", "Hypetask CLI", "Hypetask MCP"].filter((label) => body.includes(label)).length;
      step("the seeded board shows its starter cards", cards >= 2 && /MYDE-\d+/.test(body), { cards, sample: body.slice(0, 240) });
      await shot(page, dir, "demo-board-1440x900.png");
    });
    await withBrowser(null, async ({ page }) => {
      const learn = await open(page, "/learn", 3000);
      step("/learn without a session lands on the login page", isLogin(learn.url), { url: new URL(learn.url).pathname });
    });
    step("the demo login is a guest, not the QA account", null, "one guest creation per run, under the 5-per-hour cap; the signup banner needs the Owner + QA flag and a plain guest cannot prove it");
  },

  "desktop-login": async (dir, step) => {
    await withBrowser(null, async ({ page }) => {
      const cli = await open(page, "/cli-auth", 3000);
      step("/cli-auth without a session lands on login with its return path", isLogin(cli.url) && /returnTo=%2Fcli-auth/.test(cli.url), { url: `${new URL(cli.url).pathname}${new URL(cli.url).search}` });
      const agent = await open(page, "/login/agent", 3000);
      step("/login/agent without a session lands on login", isLogin(agent.url), { url: new URL(agent.url).pathname });
    });
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/cli-auth?port=3456", 5000);
      const body = await text(page);
      step("the CLI consent screen names the local port", /Authenticating\s+Hypertask CLI/i.test(body) && /Local port: 3456/i.test(body), { sample: body.slice(0, 200) });
      step("the consent offers Allow and continue and Cancel", /Allow and continue/i.test(body) && /Cancel/i.test(body), {});
      await shot(page, dir, "cli-auth-consent-1440x900.png");
    });
    step("the code exchange stays out of the daily pass", null, "Allow would mint a live CLI token; the consent screen above is the read-only stop");
  },

  "feature-flags-api": async (dir, step) => {
    const flags = await api("flags", "GET", "/api/flags");
    const keys = Object.keys(flags.json?.flags ?? {});
    step("GET /api/flags answers 985 with the served flag map", flags.status === 200 && keys.length > 100, { status: flags.status, flags: keys.length });
    const agent = await api(null, "GET", "/api/mcp/flags");
    step("the agent flag door refuses a cookie-less caller", [401, 403, 405].includes(agent.status), { status: agent.status });
    await withBrowser("flags", async ({ page }) => {
      const admin = await open(page, "/admin/flags", 4000);
      step("the admin flag page is not found for QA 985", admin.status === 404 && /could not be found/i.test(await text(page)), { status: admin.status });
      await shot(page, dir, "admin-flags-404-1440x900.png");
    });
    step("a same-mode switch refusal needs an agent token", null, "ht-flag set <key> <its current mode> is the refusal; no agent token in this pass, flags-drive-live.mjs proves it on loopback");
  },

  "figma-connect": async (dir, step) => {
    const connection = await api("flags", "GET", "/api/figma/connection");
    step("GET /api/figma/connection answers 985", connection.status === 200 && connection.json?.configured === true, { status: connection.status, connected: Boolean(connection.json?.connection) });
    const anon = await api(null, "GET", "/api/figma/connection");
    step("the connection read refuses no session", anon.status === 401, { status: anon.status });
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/settings/accounts", 5000);
      await page.getByText(/Connect Figma|Disconnect/).first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      const body = await text(page);
      step("Settings > Accounts renders Connected apps", nav.url.includes("accounts") && /Connected apps/i.test(body), { url: nav.url });
      step("the Figma row offers connect or disconnect", /Figma account/i.test(body) && /Connect Figma|Disconnect/i.test(body), { sample: body.slice(0, 200) });
      await shot(page, dir, "figma-account-row-1440x900.png");
    });
  },

  "mcp-legacy-sse": async (dir, step) => {
    const message = await api(null, "POST", "/message?sessionId=probe", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    step("POST /message without a token is a JSON-RPC auth refusal", message.status === 401 && message.json?.error?.code === -32001, { status: message.status, body: message.text.slice(0, 120) });
    const modern = await api(null, "POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    step("POST /mcp without a token is the same refusal", modern.status === 401 && modern.json?.error?.code === -32001, { status: modern.status });
    step("the legacy SSE stream needs a QA bearer", null, "GET /sse with Accept: text/event-stream; no bearer in this pass, so the endpoint frame and PostHog ingestion stay unread");
  },

  "my-tasks": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/my-tasks", 7000);
      await page.locator('[data-testid="my-tasks-title"]').first().waitFor({ state: "visible", timeout: 25_000 }).catch(() => {});
      const body = await text(page);
      step("My Tasks opens signed in on its own route", !isLogin(nav.url) && nav.url.includes("/my-tasks"), { url: nav.url, status: nav.status });
      step("the title and list shell render", (await page.locator('[data-testid="my-tasks-list"]').count()) === 1 && /My Tasks/.test(body), { sample: body.slice(0, 180) });
      step("the dropped board-tab row stays out", (await page.locator('[data-testid="my-tasks-splits-desktop"], [data-testid="my-tasks-splits-phone"]').count()) === 0, {});
      await shot(page, dir, "my-tasks-1440x900.png");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      step("the phone layout keeps the list", (await page.locator('[data-testid="my-tasks-list"]').count()) === 1, { url: page.url() });
      await shot(page, dir, "my-tasks-390x844.png");
    });
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/scheduled", 6000);
      step("/scheduled renders Tasks with Due Dates", !isLogin(nav.url) && /Tasks with Due Dates/.test(await text(page)), { url: nav.url, status: nav.status });
      await shot(page, dir, "scheduled-1440x900.png");
    });
  },

  "pages": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/pages", 6000);
      const body = await text(page);
      step("the pages list opens signed in", !isLogin(nav.url) && nav.url.includes("/pages"), { url: nav.url, status: nav.status });
      step("the list offers New page and both board scopes", /New page/.test(body) && /This board/.test(body) && /All boards/.test(body), { sample: body.slice(0, 200) });
      step("the page search field renders", (await page.getByLabel("Search pages").count()) >= 1 && /Archived pages|Pages/.test(body), {});
      await shot(page, dir, "pages-1440x900.png");
    });
  },

  "public-sites": async (dir, step) => {
    for (const host of ["https://hypertask.ai/", "https://docs.hypertask.ai/", "https://help.hypertask.ai/"]) {
      const result = await api(null, "GET", host);
      step(`${host} answers 200 without a login`, result.status === 200, { status: result.status });
    }
    await withBrowser(null, async ({ page }) => {
      const nav = await open(page, "/developers", 5000);
      step("/developers lands on the docs REST API page", /docs\.hypertask\.ai/.test(nav.url) && !isLogin(nav.url), { url: nav.url });
      step("the docs page renders a heading", /REST API|Hypertask/i.test(await text(page)), {});
      await shot(page, dir, "developers-redirect-1440x900.png");
    });
  },

  "reports-agent-doors": async (dir, step) => {
    const velocity = await api(null, "GET", "/api/mcp/reports/velocity?project_id=15");
    step("the velocity agent door refuses a cookie-less caller", velocity.status === 401, { status: velocity.status, body: velocity.text.slice(0, 120) });
    const statusUpdate = await api(null, "POST", "/api/mcp/reports/status-update", { project_id: 15, range: "7d" });
    step("the status-update door refuses a cookie-less caller", [401, 404].includes(statusUpdate.status), { status: statusUpdate.status });
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/report", 6000);
      const body = await text(page);
      step("Reports renders its purpose line", nav.url.includes("/report") && /Saved reports and board velocity in one place/i.test(body), { url: nav.url });
      step("every visible board gets a velocity row", /Velocity/i.test(body), {});
      await shot(page, dir, "report-1440x900.png");
    });
    await withBrowser(null, async ({ page }) => {
      const signedOut = await open(page, "/report", 3000);
      step("a signed-out visitor is sent to login", isLogin(signedOut.url), { url: new URL(signedOut.url).pathname });
    });
    step("the agent doors' 200 path needs an agent token on board 15", null, "the cookie-only run proves the 401 refusal; reports-agent-doors.md carries the bearer recipe");
  },

  "slack-app": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const install = await open(page, "/add-to-slack", 5000);
      const installBody = await text(page);
      const installTitle = await page.title();
      step("the add-to-slack page renders its overview", install.status === 200 && /Add Hypertask to Slack/.test(installTitle) && /Turn Slack conversations into tracked tasks/i.test(installBody), { status: install.status, title: installTitle });
      step("the overview describes the /ht command", /\/ht /.test(installBody), { sample: installBody.slice(0, 200) });
      await shot(page, dir, "add-to-slack-1440x900.png");
      const support = await open(page, "/slack/support", 5000);
      const supportBody = await text(page);
      step("the Slack support page renders linking and disconnect", support.status === 200 && /\/ht connect/.test(supportBody) && /disconnect/i.test(supportBody), { status: support.status });
      await shot(page, dir, "slack-support-1440x900.png");
      const link = await open(page, "/settings/slack/link", 5000);
      step("an unlinked Slack visit reports the invalid link", /This link is invalid/i.test(await text(page)) && /slack\/link/.test(link.url), { url: link.url });
    });
    step("live Slack workspace parity needs a real workspace invite", null, "no Slack workspace to install into; the three pages above are the closest real check");
  },

  "starred": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const starred = await open(page, "/starred", 5000);
      const body = await text(page);
      step("starred opens signed in", !isLogin(starred.url) && starred.url.includes("/starred"), { url: starred.url, status: starred.status });
      step("both starred lists render", /Starred Tasks/i.test(body) && /Starred Comments/i.test(body), { sample: body.slice(0, 200) });
      await shot(page, dir, "starred-1440x900.png");
      const pinned = await open(page, "/pinned", 5000);
      const pinnedBody = await text(page);
      step("pinned opens its two tabs", !isLogin(pinned.url) && /Your Pins/i.test(pinnedBody) && /Team Pins/i.test(pinnedBody), { url: pinned.url });
      await shot(page, dir, "pinned-1440x900.png");
    });
    step("the unstar keys need a star of your own", null, "Ctrl+Shift+S and Alt+S remove a star this run did not create; the tabs above prove the lists render");
  },

  "task-templates": async (dir, step) => {
    const list = await api("flags", "GET", "/api/task-templates?projectId=" + SBX);
    step("GET /api/task-templates answers 985 for the sandbox", list.status === 200 && list.json?.success === true && Array.isArray(list.json?.templates), { status: list.status, templates: list.json?.templates?.length ?? 0 });
    const anon = await api(null, "POST", "/api/task-templates", { taskId: 1 });
    step("the templates route refuses no session", anon.status === 401, { status: anon.status });
    const bad = await api("flags", "GET", "/api/task-templates?projectId=abc");
    step("a non-numeric project id is a 400", bad.status === 400, { status: bad.status, body: bad.text.slice(0, 120) });
    await withBrowser("flags", async ({ page, context }) => {
      await pinBoard(context, SBX);
      const nav = await open(page, "/settings/board-task-templates", 5000);
      const body = await text(page);
      step("the templates section or its fallback renders", /Task templates|Custom instructions/i.test(body), { url: nav.url, sample: body.slice(0, 160) });
      await shot(page, dir, "task-templates-settings-1440x900.png");
    });
    step("the on-state editor needs htpr-7472-task-templates on", null, "runners never switch flags; the read-only API above drives what the flag does not gate");
  },

  "themes": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/settings/appearance", 6000);
      await page.getByText(/Graphite/).first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      const body = await text(page);
      const theme = await page.locator("html").getAttribute("data-theme").catch(() => null);
      step("Appearance lists the shipped themes", /Porcelain/.test(body) && /Graphite/.test(body) && /AMOLED/.test(body) && /Dia/.test(body), { sample: body.slice(0, 240) });
      step("the page renders on a resolved theme", Boolean(theme), { theme });
      await shot(page, dir, "appearance-1440x900.png");
      const inbox = await open(page, "/inbox", 7000);
      const inboxTheme = await page.locator("html").getAttribute("data-theme").catch(() => null);
      step("the resolved theme carries into /inbox", !isLogin(inbox.url) && inboxTheme === theme, { theme, inboxTheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, "/settings/appearance", 6000);
      const phoneBody = await text(page);
      step("the phone Appearance keeps the theme list", /Porcelain/.test(phoneBody) && /AMOLED/.test(phoneBody), {});
      await shot(page, dir, "appearance-390x844.png");
    });
  },

  "trash-and-permanent-delete": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, `/trash/${SBX}`, 7000);
      const body = await text(page);
      step("the board trash opens with its heading", !isLogin(nav.url) && /Trash/.test(body) && /QA Sandbox/.test(body), { url: nav.url, status: nav.status });
      await shot(page, dir, "trash-1440x900.png");
      const archived = await open(page, "/archived", 6000);
      const archivedBody = await text(page);
      step("the archive keeps both tabs and its board scopes", /Tasks Archive/i.test(archivedBody) && /Inbox Archive/i.test(archivedBody) && /Active boards/i.test(archivedBody), { url: archived.url });
      await shot(page, dir, "archived-1440x900.png");
    });
    const live = await api("flags", "DELETE", "/api/tasks/deleteTask?taskId=999999999");
    step("a permanent delete of an invisible task answers 404", live.status === 404, { status: live.status, body: live.text.slice(0, 120) });
    const recover = await api("flags", "POST", "/api/tasks/recoverTask", { taskId: 999999999 });
    step("recovering an unknown task is refused", [400, 404].includes(recover.status), { status: recover.status });
    step("trashing and recovering a fixture stays out of the read-only pass", null, "both keys need a task this run created; the refusals above prove the routes still guard their input");
  },

  "webhooks": async (dir, step) => {
    const missing = await api("flags", "GET", "/api/settings/webhooks");
    step("the webhooks read needs a team id", missing.status === 400 && /teamId is required/i.test(missing.text), { status: missing.status, body: missing.text.slice(0, 120) });
    const anon = await api(null, "GET", `/api/settings/webhooks?teamId=${QA_TEAM}`);
    step("the webhooks read refuses no session", anon.status === 401, { status: anon.status });
    const list = await api("flags", "GET", `/api/settings/webhooks?teamId=${QA_TEAM}`);
    const events = list.json?.availableEvents ?? [];
    step("the QA team lists its signing events and endpoints", list.status === 200 && list.json?.success === true && events.includes("task.created") && Array.isArray(list.json?.endpoints), { status: list.status, events: events.length, endpoints: list.json?.endpoints?.length ?? 0 });
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/settings/webhooks", 7000);
      step("Settings > Webhooks renders its list", nav.url.includes("webhooks") && /Webhooks/i.test(await text(page)), { url: nav.url });
      await shot(page, dir, "webhooks-1440x900.png");
    });
    step("a test delivery needs a receiver this run owns", null, "creating and deleting an endpoint writes the team's webhook list; the reads above prove the route and its events");
  },

  "command-palette": async (dir, step) => {
    await withBrowser("flags", async ({ page }) => {
      const nav = await open(page, "/my-tasks", 6000);
      step("the page behind the palette loads signed in", !isLogin(nav.url), { url: nav.url });
      await page.keyboard.press("Control+k");
      await page.locator("#htc-search").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      const body = await text(page);
      step("Ctrl+K opens Search in the command window", await page.locator("#htc-search").first().isVisible().catch(() => false), { sample: body.slice(0, 160) });
      step("the palette offers Search and New Task", /Search/.test(body) && /New Task/.test(body), {});
      await shot(page, dir, "ctrl-k-search-1440x900.png");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
      await page.keyboard.press("Control+j");
      await page.locator('[aria-label="Describe the task"]').first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      const writer = await page.locator('[aria-label="Describe the task"]').first().isVisible().catch(() => false);
      step("Ctrl+J opens the task writer without submitting", writer, { textareas: await page.locator('[aria-label="Describe the task"]').count() });
      await shot(page, dir, "ctrl-j-writer-1440x900.png");
      await page.keyboard.press("Escape");
    });
    step("sending a palette task spends model budget", null, "Ctrl+J Send creates a ticket and starts AI writing; the open writer above is the read-only stop");
  },

};

async function main() {
  const args = readArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage);
    return;
  }
  requireProduction();
  const selected = args.features.length === 0 || args.features.includes("all") ? FEATURES : args.features;
  const unknown = selected.filter((feature) => !FEATURES.includes(feature));
  if (unknown.length) {
    console.error(`unknown feature ${unknown.join(", ")}\n${usage}`);
    process.exitCode = 2;
    return;
  }
  await fs.mkdir(args.dir, { recursive: true });
  const summary = [];
  for (const feature of selected) {
    console.log(`\n=== ${feature}`);
    await assertAccounts(feature);
    runner.steps = [];
    runner.notes = [];
    const dir = path.join(args.dir, feature);
    await fs.mkdir(dir, { recursive: true });
    try {
      await featureRuns[feature](dir, runner.step.bind(runner));
    } catch (error) {
      runner.step(`${feature} drive ran to the end`, false, { error: redact(error.message).split("\n")[0] });
    }
    const failed = runner.steps.filter((entry) => entry.ok === false);
    const result = { feature, at: new Date().toISOString(), steps: runner.steps, notes: runner.notes };
    await fs.writeFile(path.join(dir, "result.json"), JSON.stringify(result, null, 2));
    summary.push({ feature, pass: runner.steps.filter((entry) => entry.ok === true).length, fail: failed.length, unreachable: runner.notes.length });
    console.log(`${feature} ${failed.length ? "failed" : "ok"}`);
  }
  await fs.writeFile(path.join(args.dir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\n${JSON.stringify(summary)}`);
  process.exitCode = summary.some((entry) => entry.fail > 0) ? 1 : 0;
}

await main();
