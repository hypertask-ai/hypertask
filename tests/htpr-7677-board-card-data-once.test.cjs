const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToString } = require("react-dom/server");
const query = require("@tanstack/react-query");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const FLAG = "htpr-7677-board-card-data-once";
const BOARD_ID = 6859;
const OTHER_BOARD_ID = 8778;

let flagOn = true;
let timerReads = [];
let draftReads = [];

const runningTimers = new Map([[1, { startedAt: "2026-10-24T10:00:00.000Z", pausedAt: null, userName: "QA" }]]);
const timeTotals = new Map([[2, { calculatedAt: "2026-10-24T10:00:00.000Z", runningTimers: [], totalSeconds: 600 }]]);

function Stub(name) {
  const component = (props) =>
    React.createElement("i", { "data-stub": name, "data-label": props?.labelValue ?? props?.startedAt ?? undefined });
  component.displayName = name;
  return component;
}

const stubModule = (name) =>
  new Proxy({ __esModule: true }, {
    get: (target, key) => (key in target ? target[key] : Stub(`${name}:${String(key)}`)),
  });

const mocks = {
  react: React,
  "react/jsx-runtime": require("react/jsx-runtime"),
  "@tanstack/react-query": query,
  axios: { __esModule: true, default: { get: () => assert.fail("custom fields must not be read for a card without values") } },
  "@/lib/state": { useRecoilValue: () => ({ id: 2343 }) },
  "@/store": { currentUserAtom: {} },
  "@/hooks/useFlag": { useFlag: (key) => key === FLAG && flagOn },
  "@/lib/flags/definitions/htpr-7677-board-card-data-once": { HTPR_7677_BOARD_CARD_DATA_ONCE_FLAG: FLAG },
  "@/lib/agentStatus/minuteClock": { useMinuteClock: () => 0 },
  "@/lib/agentStatus/chip": { agentStatusIsFresh: () => false, agentStatusText: () => "", agentStepFor: () => "" },
  "@/lib/timeDuration": { formatElapsed: (seconds) => `${seconds}s` },
  "@/lib/boardTimeTotals": { displayedBoardTimeSeconds: (total) => total?.totalSeconds ?? 0 },
  "@/hooks/General/useGetUserDrafts": {
    useGetUserDrafts: (userId) => {
      if (userId !== undefined) draftReads.push(userId);
      return { draftTaskIds: new Set([2]) };
    },
  },
  "@/hooks/Task Detail/useTimeTracking": {
    useTimerNow: () => Date.parse("2026-10-24T10:10:00.000Z"),
    useBoardRunningTimers: (projectId, options) => {
      if (options?.enabled !== false) timerReads.push(projectId);
      return { showTimeTotals: true, timers: runningTimers, timeTotals };
    },
  },
};
for (const mock of Object.values(mocks)) {
  if (typeof mock === "object" && "default" in mock) mock.__esModule = true;
}

const compiledModules = {};
function load(relative) {
  if (compiledModules[relative]) return compiledModules[relative];
  const compiled = ts.transpileModule(read(relative), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleExports = {};
  compiledModules[relative] = moduleExports;
  new Function("require", "exports", compiled)((name) => {
    if (name === "./BoardCardData") return load("src/components/PageComponents/Kanban/KanbanTaskComponents/BoardCardData.tsx");
    if (name in mocks) return mocks[name];
    return stubModule(name);
  }, moduleExports);
  return moduleExports;
}

const { BoardCardDataProvider, useBoardCardData } = load("src/components/PageComponents/Kanban/KanbanTaskComponents/BoardCardData.tsx");
const TaskTagsRow = load("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx").default;

const project = { id: BOARD_ID, sections: [] };
const cards = [1, 2, 3, 4, 5].map((id) => ({ id, projectId: BOARD_ID, taskLabels: [] }));
const noop = () => {};

function renderBoard(tasks) {
  timerReads = [];
  draftReads = [];
  const client = new query.QueryClient();
  const html = renderToString(
    React.createElement(query.QueryClientProvider, { client },
      React.createElement(BoardCardDataProvider, { project, enabled: flagOn },
        tasks.map((task) =>
          React.createElement("div", { key: task.id, "data-card": task.id },
            React.createElement(TaskTagsRow, {
              task,
              project,
              setShowEstimateModal: noop,
              setShowPriorityModal: noop,
              setShowCreateLabelModal: noop,
              setShowAssignModal: noop,
              toggleDueDate: noop,
              updateActiveItemAndItemInView: noop,
              dueDate: undefined,
              priority: undefined,
              estimate: undefined,
              taskLabels: [],
            }))))));
  client.clear();
  return { html, timerReads, draftReads };
}

test("with the flag on, five cards share one running-timer read and one drafts read", () => {
  flagOn = true;
  const { timerReads: timers, draftReads: drafts } = renderBoard(cards);
  assert.deepEqual(timers, [BOARD_ID]);
  assert.deepEqual(drafts, [2343]);
});

test("with the flag off, every card keeps its own running-timer read and the board reads nothing", () => {
  flagOn = false;
  const { timerReads: timers, draftReads: drafts } = renderBoard(cards);
  assert.deepEqual(timers, cards.map(() => BOARD_ID));
  assert.deepEqual(drafts, []);
});

test("cards draw the same running timer and time total with the flag on and off", () => {
  flagOn = true;
  const on = renderBoard(cards).html;
  flagOn = false;
  const off = renderBoard(cards).html;
  assert.equal(on, off);
  const badges = [...on.matchAll(/data-card="(\d)"><div[^>]*><span[^>]*>(\d+s)<\/span>/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(badges, ["1:0s", "2:600s"]);
});

test("a card from another board on this board still reads its own board's timers", () => {
  flagOn = true;
  const { timerReads: timers } = renderBoard([...cards, { id: 9, projectId: OTHER_BOARD_ID, taskLabels: [] }]);
  assert.deepEqual(timers, [BOARD_ID, OTHER_BOARD_ID]);
});

test("the shared drafts reach each card as its own Draft mark", () => {
  flagOn = true;
  const DraftMark = ({ task }) => {
    const shared = useBoardCardData(task.projectId);
    return React.createElement("b", null, shared?.draftTaskIds.has(task.id) ? `draft-${task.id}` : `clean-${task.id}`);
  };
  const html = renderToString(
    React.createElement(BoardCardDataProvider, { project, enabled: true },
      cards.slice(0, 3).map((task) => React.createElement(DraftMark, { key: task.id, task }))));
  assert.equal(html, "<b>clean-1</b><b>draft-2</b><b>clean-3</b>");
});

test("the flag is read once when the board opens, so cards never switch readers while it is open", () => {
  const provider = read("src/components/PageComponents/Kanban/KanbanTaskComponents/BoardCardData.tsx");
  assert.match(provider, /const \[shared\] = useState\(enabled\);/);
  const homepage = read("src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx");
  assert.match(homepage, /boardCardDataOnce \? \(\n      <BoardCardDataProvider project=\{_currentProject\} enabled>\{board\}<\/BoardCardDataProvider>\n    \) : \(\n      <BoardCardDataProvider project=\{_currentProject\} enabled=\{false\}>\{board\}<\/BoardCardDataProvider>/);
});

test("the card takes its Draft mark from the board when it can and keeps its own drafts read otherwise", () => {
  const task = read("src/components/PageComponents/Kanban/KanbanTaskComponents/task.tsx");
  assert.match(task, /return boardCardDataOnce && boardCardData \? \(/);
  assert.match(task, /hasDraft=\{boardCardData\.draftTaskIds\.has\(props\.task\.id\)\}/);
  assert.match(task, /<TaskContentWithOwnDrafts \{\.\.\.contentProps\} \/>/);
  assert.equal(task.match(/useGetUserDrafts\(/g).length, 1, "only the fallback reads drafts per card");
});

test("a card without custom field values sets up no custom field read", () => {
  const row = read("src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx");
  assert.match(row, /\{hasCustomFieldValues && <CustomFieldChips /);
});
