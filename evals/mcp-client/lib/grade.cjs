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

function gradeMcp(task, observedTools) {
  const expected = task.mcp.tools;
  if (!Array.isArray(observedTools) || observedTools.length < expected.length) {
    return { pass: false, reason: "missing MCP tool calls" };
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

function gradeCli(task, observedCommands) {
  const expected = task.cli.commands;
  if (!Array.isArray(observedCommands) || observedCommands.length < expected.length) {
    return { pass: false, reason: "missing CLI commands" };
  }
  for (let i = 0; i < expected.length; i += 1) {
    const want = expected[i].argv;
    const got = observedCommands[i]?.argv || [];
    const prefixMatches = want.every((part, index) => got[index] === part);
    if (!prefixMatches) {
      return {
        pass: false,
        reason: `expected ${want.join(" ")}, got ${got.join(" ")}`,
      };
    }
  }
  return { pass: true, reason: null };
}

function gradeObservation(task, transport, observation) {
  if (transport === "mcp") return gradeMcp(task, observation.tools);
  return gradeCli(task, observation.commands);
}

module.exports = {
  valuesMatch,
  gradeMcp,
  gradeCli,
  gradeObservation,
};
