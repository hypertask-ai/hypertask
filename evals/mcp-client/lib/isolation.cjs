"use strict";

const { spawnSync } = require("node:child_process");
const { snapshotState } = require("./fixture.cjs");

function liveIsolationFromEnv(env = process.env) {
  const projectId = env.EVAL_PROJECT_ID ? Number(env.EVAL_PROJECT_ID) : null;
  const ticket = env.EVAL_TICKET || "";
  const taskId = env.EVAL_TASK_ID ? Number(env.EVAL_TASK_ID) : null;
  if (!projectId) return null;
  return {
    projectId,
    ticket: ticket || "EVAL-1",
    taskId: Number.isFinite(taskId) ? taskId : 1,
  };
}

function bindTask(task, isolation) {
  if (!isolation) return task;
  const replace = (value) => {
    if (value == null) return value;
    if (typeof value === "number") {
      return value === 99 ? isolation.projectId : value;
    }
    if (typeof value === "string") {
      return value
        .replaceAll("project 99", `project ${isolation.projectId}`)
        .replaceAll("EVAL-1", isolation.ticket)
        .replaceAll('"99"', `"${isolation.projectId}"`);
    }
    if (Array.isArray(value)) return value.map(replace);
    if (typeof value === "object") {
      const next = {};
      for (const [key, child] of Object.entries(value)) {
        if (key === "project_id" && child === 99) {
          next[key] = isolation.projectId;
          continue;
        }
        if (key === "task_id" && isolation.taskId) {
          next[key] = isolation.taskId;
          continue;
        }
        if (key === "task" && child === "EVAL-1") {
          next[key] = isolation.ticket;
          continue;
        }
        next[key] = replace(child);
      }
      return next;
    }
    return value;
  };
  const bound = replace(task);
  bound.cli = {
    ...bound.cli,
    commands: (bound.cli?.commands || []).map((command) => ({
      ...command,
      argv: (command.argv || []).map((part) => {
        if (part === "99") return String(isolation.projectId);
        if (part === "EVAL-1") return isolation.ticket;
        return part;
      }),
    })),
  };
  return bound;
}

function captureStateViaCli(env, isolation, hypertaskBin) {
  if (!hypertaskBin || !isolation?.ticket) return undefined;
  const prefix = ["--json"];
  if (env.EVAL_API_URL) prefix.push("--api-url", env.EVAL_API_URL);
  if (env.EVAL_TOKEN) prefix.push("--token", env.EVAL_TOKEN);
  const get = spawnSync(hypertaskBin, [...prefix, "task", "get", isolation.ticket], {
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
  const comments = spawnSync(hypertaskBin, [...prefix, "comment", "list", isolation.ticket], {
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
  try {
    const task = JSON.parse(get.stdout || "{}");
    const commentPayload = JSON.parse(comments.stdout || "{}");
    const commentCount = Array.isArray(commentPayload.comments)
      ? commentPayload.comments.length
      : Array.isArray(task.comments)
        ? task.comments.length
        : undefined;
    return {
      ticket: task.ticketNumber || isolation.ticket,
      title: task.title,
      section: task.section,
      commentCount,
      createdCount: undefined,
      timeLogCount: undefined,
      assignees: (task.assignees || []).map((item) => item.displayName || item.email || item),
    };
  } catch {
    return undefined;
  }
}

function boardStateOrCli(board, env, isolation, hypertaskBin) {
  if (board) return snapshotState(board);
  return captureStateViaCli(env, isolation, hypertaskBin);
}

function missingRequiredClients(rows, required) {
  const missing = [];
  for (const client of required) {
    const clientRows = rows.filter((row) => row.client === client);
    const transports = new Set(clientRows.map((row) => row.transport));
    if (!transports.has("mcp") || !transports.has("cli")) {
      missing.push(client);
    }
  }
  return missing;
}

module.exports = {
  liveIsolationFromEnv,
  bindTask,
  captureStateViaCli,
  boardStateOrCli,
  missingRequiredClients,
};
