#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";

const BASE = "https://app.hypertask.ai";
const INBOX_SECRET = process.env.CRON_SECRET || "";
const REPORT_TOKEN = process.env.HYPERTASK_MCP_TOKEN || "";
const PARENT_TICKET = process.env.FUNNEL_PROBE_PARENT_TICKET || "MARK-164";
const OWNER = process.env.FUNNEL_PROBE_OWNER || "HT Product Lead";
const TASK_TITLES = ["Probe task one", "Probe task two", "Probe task three"];
const steps = [];

function record(step, ok, detail) {
  steps.push({ step, ok, detail: String(detail).slice(0, 240) });
  console.log(`${ok ? "PASS" : "FAIL"} ${step}: ${detail}`);
}

function dailyEmail(runId, role = "owner") {
  const day = new Date().toISOString().slice(0, 10);
  const suffix = createHash("sha256").update(runId).digest("hex").slice(0, 10);
  return `daily-${day}-${suffix}-${role}@funnel-probe.hypertask.app`;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path, { method = "GET", body, token } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, json };
}

async function pollInbox(email) {
  for (let i = 0; i < 12; i++) {
    const response = await api(
      `/api/ops/funnel-probe-inbox?email=${encodeURIComponent(email)}`,
      { token: INBOX_SECRET },
    );
    if (response.status === 404) { await wait(5_000); continue; }
    if (response.json?.found && response.json.entry?.verificationUrl) {
      return response.json.entry.verificationUrl;
    }
    await wait(5_000);
  }
  return null;
}

async function postReport(passed, runId) {
  const lines = steps
    .map((s) => `<li><p>${s.ok ? "PASS" : "FAIL"}: ${s.step} — ${s.detail}</p></li>`)
    .join("");
  const failed = steps.filter((s) => !s.ok).map((s) => s.step);
  const verdict = passed
    ? "PASS: daily funnel probe walked every signup step"
    : `FAIL: daily funnel probe stopped at ${failed[0]} (owner ${OWNER})`;
  const header = `<p><strong>${verdict}</strong></p>`;
  const footer = `<p>Run ${runId}. Probe accounts are labelled probe and excluded from customer numbers; the board, its three tasks and the invite are deleted at the end, and only the probe account remains.</p>`;
  try {
    const response = await api("/api/mcp/comments", {
      method: "POST",
      token: REPORT_TOKEN,
      body: {
        ticket_number: PARENT_TICKET,
        project_id: 2108,
        text: `${header}<ul>${lines}</ul>${footer}`,
        content_type: "html",
      },
    });
    record("mark-164 report", response.ok, response.ok ? "posted" : `HTTP ${response.status}`);
    return response.ok;
  } catch (error) {
    record("mark-164 report", false, error?.message || String(error));
    return false;
  }
}

async function walkFunnel(browser, email, teammateEmail, runId) {
  const page = await browser.newPage();
  try {
    const verifyUrl = await pollInbox(email);
    record("verification inbox", Boolean(verifyUrl), verifyUrl ? "link ready" : "no link after polling");
    if (!verifyUrl) return {};

    let verified = false;
    let verifyDetail = "navigation failed";
    try {
      await page.goto(verifyUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.getByText("successfully verified", { exact: false }).waitFor({ timeout: 120_000 });
      verified = true;
      verifyDetail = new URL(page.url()).pathname;
    } catch { verified = false; }
    record("email verify navigation", verified, verifyDetail);
    if (!verified) return {};

    const codeResponse = await page.request.post(`${BASE}/api/cli/generate-code`, { headers: { Accept: "application/json" } });
    const codeJson = await codeResponse.json().catch(() => ({}));
    record("connect code", codeResponse.ok() && Boolean(codeJson.code), `HTTP ${codeResponse.status()}`);
    if (!codeJson.code) return {};

    const exchanged = await api("/api/cli/token-exchange", { method: "POST", body: { code: codeJson.code } });
    const token = exchanged.json?.token;
    record("connect command line", Boolean(token), `HTTP ${exchanged.status}`);
    if (!token) return {};

    const context = await api("/api/mcp/user/context", { token });
    const teamId = context.json?.teams?.[0]?.id;
    record("probe team", Boolean(teamId), context.json?.teams?.length ? `${context.json.teams.length} team` : `HTTP ${context.status}`);
    if (!teamId) return {};

    const board = await api(`/api/mcp/teams/${encodeURIComponent(teamId)}/boards`, {
      method: "POST",
      token,
      body: {
        title: `Probe board ${runId.slice(0, 8)}`,
        sections: [{ title: "Todo" }, { title: "Done" }],
      },
    });
    const boardId = board.json?.board?.id;
    record("own board created", Boolean(boardId), boardId ? `board ${boardId}` : `HTTP ${board.status} ${board.json?.message || board.json?.error || ""}`);
    if (!boardId) return { token, verified: true };

    const created = [];
    for (const title of TASK_TITLES) {
      const task = await api("/api/mcp/tasks", { method: "POST", token, body: { project_id: boardId, title } });
      if (task.json?.task?.id) created.push(task.json.task.id);
    }
    record("three tasks created", created.length === TASK_TITLES.length, `${created.length} of ${TASK_TITLES.length} saved`);

    const invite = await api(`/api/mcp/projects/${boardId}/members`, {
      method: "POST",
      token,
      body: { userToAdd: teammateEmail },
    });
    record("teammate invited", invite.ok, invite.ok ? "second probe address invited" : `HTTP ${invite.status} ${invite.json?.error || ""}`);

    await wait(5_000);
    const state = await api(`/api/ops/funnel-probe-state?email=${encodeURIComponent(email)}`, { token: INBOX_SECRET });
    const saved = state.json?.state;
    const kinds = new Set((saved?.events ?? []).filter((event) => event.processed).map((event) => event.kind));
    const readback = Boolean(
      saved &&
        saved.boardId === boardId &&
        saved.taskCount >= TASK_TITLES.length &&
        saved.pendingInviteCount >= 1 &&
        saved.connectionCount >= 1,
    );
    record("steps saved", readback, saved ? `board ${saved.boardId}, ${saved.taskCount} tasks, ${saved.pendingInviteCount} invites, ${saved.connectionCount} connections` : `HTTP ${state.status}`);
    record(
      "events recorded",
      ["board_created", "task_created", "invite_sent"].every((kind) => kinds.has(kind)),
      [...kinds].join(",") || "no probe events",
    );
    record("customer numbers clean", saved?.accountCategory === "probe", saved?.accountCategory ?? "unknown");

    const removed = await api("/api/mcp/projects/archive", { method: "POST", token, body: { project_id: boardId, status: "Deleted" } });
    record("cleanup", removed.ok, removed.ok ? "probe board deleted" : `HTTP ${removed.status}`);
    const revoked = await page.request.post(`${BASE}/api/connections/revoke-all`, { headers: { Accept: "application/json" } });
    record("tool disconnected", revoked.ok(), `HTTP ${revoked.status()}`);
    return { token, verified: true };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function main() {
  if (!INBOX_SECRET) throw new Error("CRON_SECRET is required");
  if (!REPORT_TOKEN) throw new Error("HYPERTASK_MCP_TOKEN is required");
  const gate = await api("/api/cron/funnel-probe-signup", { token: INBOX_SECRET });
  if (gate.status === 404 && gate.json?.disabled) {
    record("probe gate", true, "probe switched off, nothing to walk");
    return postReport(true, "disabled");
  }
  if (!gate.ok) {
    record("probe gate", false, `HTTP ${gate.status}`);
    return postReport(false, "gate");
  }
  const runId = randomUUID();
  record("probe gate", true, "production probe enabled");
  const email = dailyEmail(runId);
  const teammateEmail = dailyEmail(runId, "teammate");
  record("new probe identity", true, `fresh identity for run ${runId.slice(0, 8)}`);
  const signup = await api("/api/auth/instant-signup", {
    method: "POST",
    token: INBOX_SECRET,
    body: { email, utmData: { utm_source: "funnel_probe_daily" } },
  });
  record("probe signup", signup.ok && signup.json?.success !== false, signup.json?.error || `HTTP ${signup.status}`);

  const browser = await chromium.launch({ headless: true });
  try {
    if (signup.ok) await walkFunnel(browser, email, teammateEmail, runId);
  } finally {
    await browser.close().catch(() => undefined);
  }
  const passed = steps.every((s) => s.ok);
  return postReport(passed, runId.slice(0, 8));
}

main()
  .then(async (reported) => {
    if (!steps.every((s) => s.ok) || !reported) process.exitCode = 1;
  })
  .catch(async (error) => {
    record("runner", false, error.message || error);
    await postReport(false, "runner").catch(() => undefined);
    process.exitCode = 1;
  });
