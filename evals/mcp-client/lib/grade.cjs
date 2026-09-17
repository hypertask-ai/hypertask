"use strict";

function valuesMatch(expected, actual) {
  if (expected == null) return true;
  if (typeof expected === "object" && !Array.isArray(expected)) {
    if (!actual || typeof actual !== "object") return false;
    return Object.keys(expected).every((key) => valuesMatch(expected[key], actual[key]));
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((item, index) => valuesMatch(item, actual[index]));
  }
  return expected === actual;
}

function collectStdout(observation) {
  const parts = [];
  if (typeof observation?.raw === "string") parts.push(observation.raw);
  for (const tool of observation?.tools || []) {
    if (tool?.stdout) parts.push(String(tool.stdout));
    if (tool?.result) parts.push(typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result));
  }
  for (const command of observation?.commands || []) {
    if (command?.stdout) parts.push(String(command.stdout));
  }
  return parts.join("\n");
}

function parseStdoutJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const match = String(stdout).match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function gradeMcpPlan(task, observedTools) {
  const expected = task.mcp.tools;
  if (!Array.isArray(observedTools)) {
    return { pass: false, reason: "missing MCP tool calls" };
  }
  if (observedTools.length !== expected.length) {
    return {
      pass: false,
      reason:
        observedTools.length > expected.length
          ? "unexpected MCP tool calls"
          : "missing MCP tool calls",
    };
  }
  for (let i = 0; i < expected.length; i += 1) {
    const got = observedTools[i];
    if (got?.name !== expected[i].name) {
      return {
        pass: false,
        reason: `expected ${expected[i].name}, got ${got?.name || "nothing"}`,
      };
    }
    if (!valuesMatch(expected[i].args || {}, got.args || {})) {
      return { pass: false, reason: `${expected[i].name} args did not match` };
    }
  }
  return { pass: true, reason: null };
}

function gradeCliPlan(task, observedCommands) {
  const expected = task.cli.commands;
  if (!Array.isArray(observedCommands)) {
    return { pass: false, reason: "missing CLI commands" };
  }
  if (observedCommands.length !== expected.length) {
    return {
      pass: false,
      reason:
        observedCommands.length > expected.length
          ? "unexpected CLI commands"
          : "missing CLI commands",
    };
  }
  for (let i = 0; i < expected.length; i += 1) {
    const want = expected[i].argv;
    const got = observedCommands[i]?.argv || [];
    const exact =
      want.length === got.length && want.every((part, index) => got[index] === part);
    if (!exact) {
      return {
        pass: false,
        reason: `expected ${want.join(" ")}, got ${got.join(" ")}`,
      };
    }
  }
  return { pass: true, reason: null };
}

function taskExpect(task, transport) {
  return {
    ...(task.expect || {}),
    ...(task[transport]?.expect || {}),
  };
}

function gradeOutcomes(task, transport, observation) {
  const expect = taskExpect(task, transport);
  const stdout = collectStdout(observation);
  if (!expect.stdoutIncludes?.length && !expect.jsonContains && !expect.state) {
    return { pass: false, reason: `${task.id} is missing outcome assertions` };
  }
  for (const needle of expect.stdoutIncludes || []) {
    if (!stdout.includes(needle)) {
      return { pass: false, reason: `stdout missing ${needle}` };
    }
  }
  if (expect.exitCode != null) {
    const statuses = (observation.commands || []).map((command) => command.status);
    if (statuses.some((status) => status !== expect.exitCode)) {
      return { pass: false, reason: `expected exit ${expect.exitCode}` };
    }
  }
  if (expect.jsonContains) {
    const parsed = parseStdoutJson(stdout);
    if (!valuesMatch(expect.jsonContains, parsed)) {
      return { pass: false, reason: "response json did not match" };
    }
  }
  if (expect.state) {
    if (!observation.state) {
      return { pass: false, reason: "missing post-operation state" };
    }
    if (!valuesMatch(expect.state, observation.state)) {
      return { pass: false, reason: "post-operation state did not match" };
    }
  }
  return { pass: true, reason: null };
}

function gradeObservation(task, transport, observation) {
  const plan =
    transport === "mcp"
      ? gradeMcpPlan(task, observation?.tools)
      : gradeCliPlan(task, observation?.commands);
  if (!plan.pass) return plan;
  return gradeOutcomes(task, transport, observation);
}

module.exports = {
  valuesMatch,
  collectStdout,
  gradeMcpPlan,
  gradeCliPlan,
  gradeOutcomes,
  gradeObservation,
};
