const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
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

test("board card and ticket header gate the dot on the ticket flag", () => {
  const tagsRow = read("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx");
  const title = read("src/components/PageComponents/TaskDetail/TopRow/TaskDetailTitleContainer.tsx");
  const headerChip = read("src/components/PageComponents/TaskDetail/TopRow/TaskDetailAgentStatusChip.tsx");
  assert.match(tagsRow, /HTPR_7339_AGENT_PULSE_DOT_FLAG/);
  assert.match(tagsRow, /AgentStatusChip/);
  assert.match(title, /TaskDetailAgentStatusChip/);
  assert.match(title, /HTPR_7339_AGENT_PULSE_DOT_FLAG/);
  assert.match(headerChip, /HTPR_7339_AGENT_PULSE_DOT_FLAG/);
  const loadTs = read("src/utils/controllers/taskDetail/load.ts");
  assert.match(loadTs, /attachAgentStatus/);
  assert.match(loadTs, /isFeatureEnabled\(HTPR_7339_AGENT_PULSE_DOT_FLAG/);
});

test("status dot uses approved size, colours and test id", () => {
  const dot = read("src/components/agentStatus/AgentStatusDot.tsx");
  assert.match(dot, /data-testid="agent-status-dot"/);
  assert.match(dot, /agent-status-dot-working/);
  assert.match(dot, /agent-status-dot-waiting/);
  assert.match(dot, /h-\[6px\] w-\[6px\]/);
  assert.match(fs.readFileSync(path.join(root, "src/styles/globals.scss"), "utf8"), /agent-status-dot-working[\s\S]*#51A4F1/);
  assert.match(fs.readFileSync(path.join(root, "src/styles/globals.scss"), "utf8"), /agent-status-dot-waiting[\s\S]*#FB773F/);
  assert.match(dot, /motion-safe:animate-pulse/);
});
