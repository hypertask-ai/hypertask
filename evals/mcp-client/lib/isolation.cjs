"use strict";

const { spawnSync } = require("node:child_process");
const { snapshotState } = require("./fixture.cjs");

function cliPrefix(env) {
  const prefix = ["--json"];
  if (env.EVAL_API_URL) prefix.push("--api-url", env.EVAL_API_URL);
  if (env.EVAL_TOKEN) prefix.push("--token", env.EVAL_TOKEN);
  return prefix;
}

function runHypertaskJson(hypertaskBin, env, argv) {
  if (!hypertaskBin) return {};
  const result = spawnSync(hypertaskBin, [...cliPrefix(env), ...argv], {
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    return {};
  }
}

function countList(payload) {
  if (Array.isArray(payload?.tasks)) return payload.tasks.length;
  if (Array.isArray(payload?.comments)) return payload.comments.length;
  if (Array.isArray(payload?.entries)) return payload.entries.length;
  if (Array.isArray(payload?.logs)) return payload.logs.length;
  if (Array.isArray(payload?.items)) return payload.items.length;
  if (Array.isArray(payload?.timeLogs)) return payload.timeLogs.length;
  if (typeof payload?.total === "number") return payload.total;
  if (typeof payload?.count === "number") return payload.count;
  return 0;
}

function liveIsolationFromEnv(env = process.env) {
  const projectId = env.EVAL_PROJECT_ID ? Number(env.EVAL_PROJECT_ID) : null;
  const ticket = env.EVAL_TICKET || "";
  const taskId = env.EVAL_TASK_ID ? Number(env.EVAL_TASK_ID) : null;
  const userId = env.EVAL_USER_ID ? Number(env.EVAL_USER_ID) : null;
  const userName = env.EVAL_USER_NAME || "";
  if (
    !Number.isInteger(projectId) ||
    projectId <= 0 ||
    !ticket ||
    !Number.isInteger(taskId) ||
    taskId <= 0 ||
    !Number.isInteger(userId) ||
    userId <= 0 ||
    !userName
  ) {
    return null;
  }
  return { projectId, ticket, taskId, userId, userName };
}

function resolveEvaluator(env, hypertaskBin) {
  if (env?.EVAL_USER_ID) {
    return {
      userId: Number(env.EVAL_USER_ID),
      userName: env.EVAL_USER_NAME || "me",
    };
  }
  const hello =
    runHypertaskJson(hypertaskBin, env, ["status"]) ||
    runHypertaskJson(hypertaskBin, env, ["context"]);
  const user = hello.user || hello.profile || hello;
  const userId = Number(user?.id || user?.userId || hello?.userId);
  const userName = user?.displayName || user?.name || env?.EVAL_USER_NAME || "me";
  return {
    userId: Number.isFinite(userId) ? userId : 1,
    userName,
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
        if (key === "assignees" && Array.isArray(child)) {
          next[key] = child.map((name) => (name === "me" ? isolation.userName || name : name));
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

function expandSelfAssign(argv, userId) {
  const next = [];
  for (const part of argv || []) {
    if (part === "--self") {
      next.push("--assignee", String(userId || 1));
      continue;
    }
    next.push(part);
  }
  return next;
}

function captureStateViaCli(env, isolation, hypertaskBin) {
  if (!hypertaskBin || !isolation?.ticket) return undefined;
  const task = runHypertaskJson(hypertaskBin, env, ["task", "get", isolation.ticket]);
  const comments = runHypertaskJson(hypertaskBin, env, ["comment", "list", isolation.ticket]);
  const created = runHypertaskJson(hypertaskBin, env, [
    "task",
    "list",
    "--project",
    String(isolation.projectId),
    "--search",
    "Eval fixture note",
  ]);
  const timeLogs = runHypertaskJson(hypertaskBin, env, [
    "time",
    "report",
    "--task",
    String(isolation.taskId || isolation.ticket),
  ]);
  const commentCount = Array.isArray(comments.comments)
    ? comments.comments.length
    : Array.isArray(task.comments)
      ? task.comments.length
      : countList(comments);
  return {
    ticket: task.ticketNumber || isolation.ticket,
    title: task.title,
    section: task.section,
    commentCount,
    createdCount: countList(created),
    timeLogCount: countList(timeLogs),
    assignees: (task.assignees || []).map((item) => item.displayName || item.email || item),
  };
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function deltaState(before, after) {
  if (!after) return after;
  if (!before) return after;
  return {
    ...after,
    commentCount: 1 + numberOrZero(after.commentCount) - numberOrZero(before.commentCount),
    createdCount: numberOrZero(after.createdCount) - numberOrZero(before.createdCount),
    timeLogCount: numberOrZero(after.timeLogCount) - numberOrZero(before.timeLogCount),
  };
}

function boardStateOrCli(board, env, isolation, hypertaskBin, before) {
  if (board) return snapshotState(board);
  const after = captureStateViaCli(env, isolation, hypertaskBin);
  return before ? deltaState(before, after) : after;
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
  resolveEvaluator,
  bindTask,
  expandSelfAssign,
  captureStateViaCli,
  deltaState,
  boardStateOrCli,
  missingRequiredClients,
};
