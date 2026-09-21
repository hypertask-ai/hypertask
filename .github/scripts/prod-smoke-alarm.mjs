import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const VARIABLE_NAME = "PROD_SMOKE_STREAK";
const INCIDENT_TITLE = "[INCIDENT] Production smoke red on consecutive deploys";
const PROJECT_ID = 15;
const SECTION_TITLE = "Valentin Review";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function parseStreak(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return 0;
  const streak = Number(value);
  return Number.isSafeInteger(streak) ? streak : 0;
}

export function decideSmokeAlarm(previousValue, outcome) {
  const previousStreak = parseStreak(previousValue);
  if (outcome === "red") {
    const streak = previousStreak + 1;
    return { previousStreak, streak, action: streak === 2 ? "alarm" : "none" };
  }
  if (outcome === "green") {
    return {
      previousStreak,
      streak: 0,
      action: previousStreak >= 2 ? "recovery" : "none",
    };
  }
  throw new Error(`Unknown smoke outcome: ${outcome}`);
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

async function jsonRequest(fetchImpl, url, options, label) {
  const response = await fetchImpl(url, options);
  const body = await responseBody(response);
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  return body;
}

function authHeaders(token, idempotencyKey) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return headers;
}

async function findOrCreateIncident(fetchImpl, config) {
  const base = config.appUrl.replace(/\/$/, "");
  const search = await jsonRequest(
    fetchImpl,
    `${base}/api/mcp/tasks?project_id=${PROJECT_ID}&status=Normal&search=${encodeURIComponent(INCIDENT_TITLE)}&limit=10`,
    { headers: authHeaders(config.mcpToken) },
    "Hypertask incident search",
  );
  if (!Array.isArray(search.tasks)) {
    throw new Error("Hypertask incident search returned no task list");
  }
  const existing = search.tasks.find((task) => task.title === INCIDENT_TITLE);
  if (existing) return { created: false, task: existing };

  const projects = await jsonRequest(
    fetchImpl,
    `${base}/api/mcp/projects?limit=100`,
    { headers: authHeaders(config.mcpToken) },
    "Hypertask project lookup",
  );
  const project = projects.projects?.find((item) => Number(item.id) === PROJECT_ID);
  const section = project?.sections?.find((item) => item.title === SECTION_TITLE);
  if (!section) throw new Error(`${SECTION_TITLE} is missing from Hypertask project ${PROJECT_ID}`);

  const views = escapeHtml(config.failingViews || "No confirmed view was recorded; inspect the run log");
  const runUrl = escapeHtml(config.runUrl);
  const sha = escapeHtml(config.sha);
  const description =
    `<p><strong>Production smoke failed on two consecutive deploys.</strong></p>` +
    `<ul>` +
    `<li><strong>Run:</strong> <a href="${runUrl}">${runUrl}</a></li>` +
    `<li><strong>Failing views:</strong> <code>${views}</code></li>` +
    `<li><strong>SHA:</strong> <code>${sha}</code></li>` +
    `</ul>`;
  const created = await jsonRequest(
    fetchImpl,
    `${base}/api/mcp/tasks/create`,
    {
      method: "POST",
      headers: authHeaders(config.mcpToken, `prod-smoke-alarm-${config.sha}`),
      body: JSON.stringify({
        project_id: PROJECT_ID,
        section_id: Number(section.id),
        title: INCIDENT_TITLE,
        description,
        content_type: "html",
      }),
    },
    "Hypertask incident creation",
  );
  return { created: true, task: created.task };
}

async function sendTelegram(fetchImpl, config, text) {
  const body = new URLSearchParams({ chat_id: config.telegramChat, text });
  const response = await fetchImpl(
    `https://api.telegram.org/bot${config.telegramToken}/sendMessage`,
    { method: "POST", body },
  );
  await responseBody(response);
  if (!response.ok) throw new Error(`Telegram alert failed with HTTP ${response.status}`);
}

async function updateStreak(fetchImpl, config, streak) {
  const base = `https://api.github.com/repos/${config.repository}/actions/variables`;
  const headers = authHeaders(config.githubToken);
  const body = JSON.stringify({ name: VARIABLE_NAME, value: String(streak) });
  let response = await fetchImpl(`${base}/${VARIABLE_NAME}`, {
    method: "PATCH",
    headers,
    body,
  });
  await responseBody(response);
  if (response.status === 404) {
    response = await fetchImpl(base, { method: "POST", headers, body });
    await responseBody(response);
  }
  if (!response.ok) {
    throw new Error(`GitHub smoke streak update failed with HTTP ${response.status}`);
  }
}

export async function handleSmokeResult(config, fetchImpl = fetch) {
  const decision = decideSmokeAlarm(config.previousStreak, config.outcome);
  if (decision.action === "alarm") {
    if (!config.mcpToken) throw new Error("HYPERTASK_MCP_TOKEN is not configured");
    await findOrCreateIncident(fetchImpl, config);
    await sendTelegram(
      fetchImpl,
      config,
      `🔴 hypertasks: production smoke is red on 2 consecutive deploys. Failing views: ${config.failingViews || "see run log"}. ${config.runUrl}`,
    );
  } else if (decision.action === "recovery") {
    await sendTelegram(
      fetchImpl,
      config,
      `🟢 hypertasks: production smoke returned to green after ${decision.previousStreak} consecutive red deploys. ${config.runUrl}`,
    );
  }
  await updateStreak(fetchImpl, config, decision.streak);
  return decision;
}

function failingViews() {
  try {
    const result = JSON.parse(readFileSync("e2e/smoke/.state/application-failure.json", "utf8"));
    return typeof result.view === "string" ? result.view : "";
  } catch {
    return "";
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY || "";
  const runUrl = `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID || ""}`;
  const decision = await handleSmokeResult({
    appUrl: "https://app.hypertask.ai",
    outcome: process.env.SMOKE_OUTCOME || "",
    previousStreak: process.env.PROD_SMOKE_STREAK || "0",
    githubToken: process.env.GITHUB_TOKEN || "",
    repository,
    mcpToken: process.env.HYPERTASK_MCP_TOKEN || "",
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
    telegramChat: process.env.TELEGRAM_CHAT_ID || "",
    runUrl,
    sha: process.env.GITHUB_SHA || "",
    failingViews: failingViews(),
  });
  console.log(`Production smoke streak is ${decision.streak}; action=${decision.action}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
