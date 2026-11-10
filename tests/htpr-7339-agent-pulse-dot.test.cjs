const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { load } = require("./task-route-loader.cjs");

const flagKey = "htpr-7339-agent-pulse-dot";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const minutesAgo = (n) => new Date(NOW - n * 60_000).toISOString();
const minute = Math.floor(NOW / 60_000);

test("pulse dot ships Owner + QA behind its ticket flag", () => {
  const {
    default: definition,
    HTPR_7339_AGENT_PULSE_DOT_FLAG,
  } = load("src/lib/flags/definitions/htpr-7339-agent-pulse-dot.ts", {});
  assert.equal(HTPR_7339_AGENT_PULSE_DOT_FLAG, flagKey);
  assert.equal(definition.key, flagKey);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.risk, "small");
});

test("dot mode pulses only inside ten minutes while working, steady while waiting", () => {
  const { agentStatusDotMode, AGENT_STATUS_DOT_PULSE_MS } = load("src/lib/agentStatus/dot.ts", {
    "@/lib/agentStatus/chip": load("src/lib/agentStatus/chip.ts"),
  });
  assert.equal(AGENT_STATUS_DOT_PULSE_MS, 10 * 60 * 1000);
  assert.equal(agentStatusDotMode(minutesAgo(1), "working", minute, NOW), "working");
  assert.equal(agentStatusDotMode(minutesAgo(9), "in QA", minute, NOW), "working");
  assert.equal(agentStatusDotMode(minutesAgo(10), "working", minute, NOW), null);
  assert.equal(agentStatusDotMode(minutesAgo(120), "working", minute, NOW), null);
  assert.equal(agentStatusDotMode(minutesAgo(120), "waiting for you", minute, NOW), "waiting");
  assert.equal(agentStatusDotMode(minutesAgo(359), "waiting for you", minute, NOW), "waiting");
  assert.equal(agentStatusDotMode(minutesAgo(360), "waiting for you", minute, NOW), null);
});

test("the status dot renders working and waiting classes", () => {
  const AgentStatusDot = load("src/components/agentStatus/AgentStatusDot.tsx", {
    react: React,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "@/utils/undoActions/helperFuncs": { cn: (...parts) => parts.filter(Boolean).join(" ") },
  }).default;
  assert.match(renderToStaticMarkup(React.createElement(AgentStatusDot, { mode: "working" })), /agent-status-dot-working/);
  assert.match(renderToStaticMarkup(React.createElement(AgentStatusDot, { mode: "waiting" })), /agent-status-dot-waiting/);
});
