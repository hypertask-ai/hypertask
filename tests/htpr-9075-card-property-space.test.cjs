const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const { clsx } = require("clsx");
const { twMerge } = require("tailwind-merge");

const flagKey = "htpr-9075-card-property-row";
const flag = load("src/lib/flags/definitions/htpr-9075-card-property-row.ts").default;
const MobileViewContext = React.createContext(false);
const empty = () => null;

const loadRow = (collapseEnabled) =>
  load("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTopRow.tsx", {
    "@/lib/contexts/mobileContext": { MobileViewContext },
    "@/lib/state": { useRecoilState: () => [null, empty] },
    "@/store": {},
    "@/components/Common/Tooltip": empty,
    "next/dynamic": () => empty,
    "@/components/Common/UserAvatar": empty,
    "../../TaskDetail/TaskOptions/HTCButton": () => React.createElement("img", { width: 16, height: 16 }),
    "@/hooks/useFlag": {
      useFlag: (key) => key === "htpr-8970-calm-cards" || (key === flagKey && collapseEnabled),
    },
    "@/lib/agentStatus/cardStatus": { useCardAgentStatus: () => null, stackFaces: (users, agents) => ({ users, agents }) },
    "@/lib/agentStatus/AgentStatusDot": empty,
    "@/lib/agentStatus/dot": { agentStatusDotMode: () => null },
    "@/lib/agentStatus/minuteClock": { useMinuteClock: () => Date.now() },
    "@/utils/undoActions/helperFuncs": { cn: (...args) => twMerge(clsx(args)) },
  });

const rowProps = {
  task: {},
  assignees: [],
  agentAssignees: [],
  notifications: [],
  ticketNumber: "",
  countNotifications: 0,
  countSubtasks: 0,
  subTaskSetting: "Card",
  hover: false,
};

const renderWith = (collapseEnabled, overrides = {}, mobile = false) =>
  renderToStaticMarkup(
    React.createElement(
      MobileViewContext.Provider,
      { value: mobile },
      React.createElement(loadRow(collapseEnabled), { ...rowProps, ...overrides }),
    ),
  );

const renderRow = (overrides = {}, mobile = false) => renderWith(true, overrides, mobile);

test("the ticket ships behind its own restricted flag", () => {
  assert.equal(flag.key, flagKey);
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("every card property off leaves no top row, so no empty space above the title", () => {
  assert.equal(renderRow(), "");
  assert.equal(renderRow({}, true), "");
  assert.equal(renderRow({ hover: true }), "", "the hover Command button alone must not reserve the row");
});

test("with the flag off the empty row stays exactly as today", () => {
  assert.ok(renderWith(false).includes("basis-full"), "the old row still renders");
});

test("one visible property keeps the row exactly as today", () => {
  const withNumber = renderRow({ ticketNumber: "HTPR-9028" });
  assert.match(withNumber, /HTPR-9028/);
  assert.ok(withNumber.includes("basis-full"), "the row keeps its full-width layout");

  assert.match(renderRow({ countNotifications: 1 }), /inbox/i);
  assert.match(renderRow({ countSubtasks: 2, subTaskSetting: "Card" }), /Reply|rotate-180/);
  assert.match(renderRow({ _count: 3 }), /MessageCircle|text-emphasis/);
  assert.match(renderRow({ assignees: [{ id: 7, displayName: "Valentin" }] }), /span/);
  const stale = React.createElement("span", { "data-testid": "card-stale-clock" });
  assert.ok(renderRow({ staleClock: stale }).includes("card-stale-clock"));
  assert.ok(renderWith(false, { staleClock: stale }).includes("card-stale-clock"));
});

test("properties switched off never reach the row: empty ticket number and no avatars", () => {
  assert.equal(renderRow({ ticketNumber: "", assignees: [], agentAssignees: [] }), "");
  assert.equal(renderRow({ notifications: [], countNotifications: 0 }), "");
  assert.equal(renderRow({ countSubtasks: 5, subTaskSetting: "None" }), "");
});
