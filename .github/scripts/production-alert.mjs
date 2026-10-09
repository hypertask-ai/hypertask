import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export async function reportProductionAlert(config, fetchImpl = fetch) {
  const { kind, cause, message, repository, githubToken, mcpToken, telegramToken, telegramChat, summaryFile } = config;
  if (!["setup", "live", "rollback"].includes(kind) || !/^[a-z0-9-]+$/.test(cause)) {
    throw new Error("Invalid production alert classification");
  }
  if (summaryFile) appendFileSync(summaryFile, `\n### ${kind}: ${cause}\n${message}\n`);
  console.log(`::warning::${String(message).replace(/[\r\n]+/g, " ")}`);
  const day = (config.now ?? new Date()).toISOString().slice(0, 10);
  const name = `PROD_ALERT_${createHash("sha256").update(`${kind}:${cause}`).digest("hex").slice(0, 24).toUpperCase()}`;
  const url = `https://api.github.com/repos/${repository}/actions/variables`;
  const headers = { Authorization: `Bearer ${githubToken}`, "Content-Type": "application/json" };
  if (!githubToken || !repository) throw new Error("Daily alert deduplication credentials are unavailable; see job summary");
  let response = await fetchImpl(`${url}/${name}`, { headers });
  if (response.ok && (await response.json()).value === day) return "duplicate";
  const missing = response.status === 404;
  if (!response.ok && !missing) throw new Error(`Daily alert lookup failed (HTTP ${response.status}); see job summary`);
  // Reserve before delivery. A failed send stays in the summary rather than
  // retrying an ambiguous delivery and sending the same cause twice today.
  response = await fetchImpl(missing ? url : `${url}/${name}`, {
    method: missing ? "POST" : "PATCH", headers, body: JSON.stringify({ name, value: day }),
  });
  if (!response.ok) throw new Error(`Daily alert reservation failed (HTTP ${response.status}); see job summary`);

  if (kind === "setup") {
    if (!mcpToken) return "summary-only";
    const title = `[INFRA] Production monitoring: ${cause}`;
    const api = async (route, options = {}) => {
      const result = await fetchImpl(`https://app.hypertask.ai/api/mcp${route}`, {
        ...options, headers: { Authorization: `Bearer ${mcpToken}`, "Content-Type": "application/json", "Idempotency-Key": `prod-monitor-${cause}-${day}` },
      });
      if (!result.ok) throw new Error(`Monitoring ticket request failed (HTTP ${result.status}); see job summary`);
      return result.json();
    };
    let existing;
    for (const status of ["Normal", "Archive", "Deleted"]) {
      const search = await api(`/tasks?project_id=4060&status=${status}&search=${encodeURIComponent(title)}&limit=100`);
      if (!Array.isArray(search.tasks)) throw new Error("Monitoring ticket search returned no task list");
      existing = search.tasks.find((task) => task.title === title);
      if (existing) break;
    }
    const text = `<p>${escapeHtml(message)}</p><p><a href="${escapeHtml(config.runUrl)}">Workflow evidence</a></p>`;
    if (existing) {
      await api("/comments", { method: "POST", body: JSON.stringify({ task_id: existing.id, text, content_type: "html" }) });
    } else {
      await api("/tasks/create", { method: "POST", body: JSON.stringify({ project_id: 4060, title, description: text, content_type: "html" }) });
    }
    return "ticket";
  }
  if (!telegramToken || !telegramChat) throw new Error("Telegram delivery credentials are unavailable; see job summary");
  response = await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
    method: "POST", body: new URLSearchParams({ chat_id: telegramChat, text: message }),
  });
  if (!response.ok || (await response.json()).ok !== true) throw new Error("Telegram delivery failed; see job summary");
  return "telegram";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reportProductionAlert({
    kind: process.argv[2], cause: process.argv[3], message: process.argv[4],
    repository: process.env.GITHUB_REPOSITORY,
    githubToken: process.env.ALERT_GITHUB_TOKEN,
    mcpToken: process.env.HYPERTASK_MCP_TOKEN,
    telegramToken: process.env.TG_TOKEN, telegramChat: process.env.TG_CHAT,
    summaryFile: process.env.GITHUB_STEP_SUMMARY,
    runUrl: `${process.env.GITHUB_SERVER_URL || "https://github.com"}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  }).catch(() => {
    // Fetch exceptions may embed credential-bearing URLs, so never log them.
    console.error("::error::Production alert delivery or ticket recording failed; details remain in the job summary");
    process.exitCode = 1;
  });
}
