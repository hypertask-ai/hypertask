const assert = require("node:assert/strict");
const test = require("node:test");
const { renderToStaticMarkup } = require("react-dom/server");
const { loader, React } = require("./helpers/htpr-7260-ui.cjs");

const PULSE_FLAG = "htpr-7339-agent-pulse-dot";
const CALM_FLAG = "htpr-8970-calm-cards";
const cn = loader({
  "@/lib/constants/APIRouteConstants": {},
  "@/lib/realtime/client": {},
  "../api/global": {},
})("src/utils/undoActions/helperFuncs.ts").cn;
const empty = () => null;
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

function topRow({ pulse, at = minutesAgo(2), sectionTitle = "In Progress", agentAssignees } = {}) {
  const flags = { [CALM_FLAG]: true, [PULSE_FLAG]: pulse };
  const TaskTopRow = loader({
    "@/hooks/useFlag": { useFlag: (key) => Boolean(flags[key]) },
    "@/utils/undoActions/helperFuncs": { cn },
    "@/lib/state": { useRecoilState: () => [null, empty] },
    "@/store": {},
    "next/dynamic": { default: () => empty },
    "../../TaskDetail/TaskOptions/HTCButton": { default: empty },
    "@/components/Common/UserAvatar": { default: ({ title }) => React.createElement("img", { "data-face": title }) },
  })("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTopRow.tsx").default;
  return renderToStaticMarkup(React.createElement(TaskTopRow, {
    task: { sectionId: 2, agentStatus: { agentName: "Runner 9", at } },
    project: { sections: [{ id: 2, section_title: sectionTitle }] },
    ticketNumber: "HTPR-7339", countSubtasks: 0, subTaskSetting: "None", hover: false,
    assignees: [{ id: 1, displayName: "Valentin" }],
    agentAssignees: agentAssignees ?? [{ id: "a", displayName: "Runner 9" }],
    countNotifications: 0, notifications: [],
  }));
}

const dots = (html) => [...html.matchAll(/data-testid="agent-status-dot"[^>]*data-mode="([^"]*)"/g)].map((match) => match[1]);

test("pulse on: the calm card pulses a dot on the working agent", () => {
  const html = topRow({ pulse: true });
  assert.deepEqual(dots(html), ["working"]);
  assert.match(html, /data-mode="working"[^>]*motion-safe:animate-pulse/);
  assert.ok(!html.includes('data-testid="agent-dot"'), "the static step dot steps aside");
});

test("pulse on: a waiting agent keeps a steady dot", () => {
  const html = topRow({ pulse: true, sectionTitle: "Valentin Review" });
  assert.deepEqual(dots(html), ["waiting"]);
  assert.ok(!/data-mode="waiting"[^>]*animate-pulse/.test(html));
});

test("pulse on: no dot once the agent stopped reporting ten minutes ago", () => {
  const html = topRow({ pulse: true, at: minutesAgo(30) });
  assert.deepEqual(dots(html), []);
  assert.ok(!html.includes('data-testid="agent-dot"'));
});

test("pulse on: the working agent shows even when nobody assigned it", () => {
  const html = topRow({ pulse: true, agentAssignees: [] });
  assert.deepEqual(dots(html), ["working"]);
  assert.match(html, /data-face="Runner 9: working, /);
});

test("pulse off: the calm card keeps today's static step dot", () => {
  const html = topRow({ pulse: false });
  assert.deepEqual(dots(html), []);
  assert.match(html, /data-step="working"[^>]*color-pull-request-green/);
});

test("pulse off: an unassigned agent stays off the card", () => {
  const html = topRow({ pulse: false, agentAssignees: [] });
  assert.ok(!html.includes('data-face="Runner 9'));
  assert.ok(!html.includes("agent-status-dot"));
});
