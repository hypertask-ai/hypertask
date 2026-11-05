import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

// Fetch exceptions may embed credential-bearing URLs and bot tokens, so the
// reason is stripped of both before it reaches a log line.
export function alertFailureReason(error) {
  return String((error && error.message) || error)
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "<token>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export async function reportProductionAlert(config, fetchImpl = fetch) {
  const { kind, cause, message, repository, githubToken, mcpToken, telegramToken, telegramChat, summaryFile } = config;
  if (!["setup", "live", "rollback"].includes(kind) || !/^[a-z0-9-]+$/.test(cause)) {
    throw new Error("Invalid production alert classification");
  }
  if (summaryFile) appendFileSync(summaryFile, `\n### ${kind}: ${cause}\n${message}\n`);
  console.log(`::warning::${String(message).replace(/[\r\n]+/g, " ")}`);
  const day = (config.now ?? new Date()).toISOString().slice(0, 10);
  const name = `${kind === "setup" ? "PROD_MONITOR" : "PROD_ALERT"}_${createHash("sha256").update(`${kind}:${cause}`).digest("hex").slice(0, 24).toUpperCase()}`;
  const url = `https://api.github.com/repos/${repository}/actions/variables`;
  const headers = { Authorization: `Bearer ${githubToken}`, "Content-Type": "application/json" };
  if (!githubToken || !repository) throw new Error("Daily alert deduplication credentials are unavailable; see job summary");
  let response;
  try { response = await fetchImpl(`${url}/${name}`, { headers }); }
  catch { throw new Error("Daily alert lookup failed (network error)"); }
  if (response.ok && (await response.json()).value === day) return "duplicate";
  const missing = response.status === 404;
  if (!response.ok && !missing) throw new Error(`Daily alert lookup failed (HTTP ${response.status}); see job summary`);
  const reserve = async () => {
    let result;
    try {
      result = await fetchImpl(missing ? url : `${url}/${name}`, {
        method: missing ? "POST" : "PATCH", headers, body: JSON.stringify({ name, value: day }),
      });
    } catch { throw new Error("Daily alert reservation failed (network error)"); }
    if (!result.ok) throw new Error(`Daily alert reservation failed (HTTP ${result.status}); see job summary`);
  };

  if (kind === "setup") {
    if (!mcpToken) return "summary-only";
    const suffix = createHash("sha256").update(cause).digest("hex").slice(0, 24);
    const title = `Production monitoring: ${cause.replaceAll("-", " ")}`;
    const api = async (route, options = {}, key = "") => {
      const method = options.method || "GET";
      let result;
      try {
        result = await fetchImpl(`https://app.hypertask.ai/api/mcp${route}`, {
          ...options, headers: { Authorization: `Bearer ${mcpToken}`, "Content-Type": "application/json", ...(key ? { "Idempotency-Key": `prod-monitor-${suffix}-${day}-${key}` } : {}) },
        });
      } catch {
        throw new Error(`Monitoring ${method} ${route.split("?")[0].replace(/\/runs\/[^/]+/, "/runs/:id")} failed (network error)`);
      }
      if (!result.ok) {
        const safeRoute = route.split("?")[0].replace(/\/runs\/[^/]+/, "/runs/:id");
        let code;
        try { code = (await result.json()).code; } catch {}
        const reason = ["invalid_field", "forbidden", "not_found", "unauthorized"].includes(code) ? `, ${code}` : "";
        throw new Error(`Monitoring ${method} ${safeRoute} failed (HTTP ${result.status}${reason})`);
      }
      try { return await result.json(); }
      catch { throw new Error(`Monitoring ${method} ${route.split("?")[0].replace(/\/runs\/[^/]+/, "/runs/:id")} returned invalid JSON`); }
    };
    let existing;
    for (const status of ["Normal", "Archive", "Deleted"]) {
      const search = await api(`/tasks?project_id=11514&status=${status}&search=${encodeURIComponent(title)}&limit=100`);
      if (!Array.isArray(search.tasks)) throw new Error("Monitoring ticket search returned no task list");
      existing = search.tasks.find((task) => task.title === title);
      if (existing) break;
    }
    if (!existing) {
      const page = await api("/projects/11514/labels");
      const labels = ["CI", "Hypertask CI"].map((name) => page.labels?.find((label) => label.name === name)?.id);
      if (labels.some((id) => !id)) throw new Error("Monitoring board labels are unavailable");
      const created = await api("/tasks/create", { method: "POST", body: JSON.stringify({ project_id: 11514, title, description: "<h2>Problem</h2><p>A production check could not finish.</p><h2>Fix</h2><p>Read the agent log for details.</p><h2>Done when</h2><p>The check finishes with a clear result.</p><h2>Risk</h2><p>A release warning could be missed.</p><h2>Decision</h2><p>None.</p>", labels }) }, "task");
      existing = created.task;
    }
    if (!Number.isSafeInteger(existing?.id) || existing.id < 1) throw new Error("Monitoring ticket returned no task id");
    const marker = `prod-monitor-${suffix}-${day}`;
    const log = await api(`/tasks/${existing.id}/agent-activity?limit=100`);
    if (!Array.isArray(log.activities)) throw new Error("Monitoring activity search returned no list");
    if (log.activities.some((activity) => activity.text?.includes(marker))) {
      await reserve();
      return "ticket";
    }
    const opened = await api("/agents/runs", { method: "POST", body: JSON.stringify({ taskId: existing.id, source: "runtime" }) });
    if (typeof opened.run?.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(opened.run.id)) throw new Error("Monitoring activity returned no run id");
    await api(`/agents/runs/${opened.run.id}/activities`, { method: "POST", body: JSON.stringify({ type: "thought", text: `${marker}\n${message}\n${config.runUrl}` }) }, "activity");
    await reserve();
    return "ticket";
  }
  await reserve();
  if (!telegramToken || !telegramChat) throw new Error("Telegram delivery credentials are unavailable; see job summary");
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
      method: "POST", body: new URLSearchParams({ chat_id: telegramChat, text: message }),
    });
  } catch { throw new Error("Telegram delivery failed (network error)"); }
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
  }).catch((error) => {
    const reason = alertFailureReason(error);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\nAlert delivery failed: ${reason}\n`);
    }
    console.error(`::error::Production alert delivery or ticket recording failed: ${reason}`);
    process.exitCode = 1;
  });
}
