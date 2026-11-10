const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const mobile = React.createContext(false);
const noop = () => {};
const marker = (name) => () => React.createElement("div", { "data-part": name }, name);
const task = {
  id: 42,
  projectId: 15,
  ticketNumber: "HTPR-9054",
  sectionId: 2,
  agentStatus: { agentName: "RUNNER 9", at: new Date().toISOString() },
  project: { section: [{ id: 2, section_title: "In Progress" }] },
  subTasks: [],
  description_: { content: "Body" },
};

function load(relative, mocks) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  for (const mock of Object.values(mocks)) if ("default" in mock) mock.__esModule = true;
  new Function("require", "exports", js)((name) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return require(name);
    assert.ok(name in mocks, `Unexpected dependency in ${relative}: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

const TitleContainer = load("src/components/PageComponents/TaskDetail/TopRow/TaskDetailTitleContainer.tsx", {
  "@/lib/contexts/TaskDetail/TaskProvider": {
    useTaskContext: () => ({ currentTask: task, parsedTask: JSON.stringify(task), cachedLayout: true }),
  },
  "@/lib/contexts/mobileContext": { MobileViewContext: mobile },
  "@/hooks/useFlag": { useFlag: () => true },
  "@/lib/flags/definitions/htpr-8991-right-column": { HTPR_8991_RIGHT_COLUMN_FLAG: "htpr-8991-right-column" },
  "@/lib/flags/definitions/htpr-8997-id-row": { HTPR_8997_ID_ROW_FLAG: "htpr-8997-id-row" },
  "@/lib/flags/definitions/htpr-8992-sticky-title": { HTPR_8992_STICKY_TITLE_FLAG: "htpr-8992-sticky-title" },
  "@/hooks/General/useCopyURL": { default: () => ({ copyTicketNumber: noop }) },
  "@/components/Common/Tooltip": { default: () => null },
  "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
  "../TaskOptions/TaskOptions": { default: marker("options") },
  "./TaskTitle": { default: marker("title") },
  "./TaskSummary": { default: marker("summary") },
  "@/components/Modals/Sheets/SummarySheet": { TaskSummaryMobile: marker("summary") },
  "./SubtaskLink": { default: marker("parent") },
  "./BaseTitleContainer": { default: ({ children }) => React.createElement("header", null, children) },
  "./MobileTaskDueDate": { default: marker("due") },
}).default;

const render = (isMobile) =>
  renderToStaticMarkup(
    React.createElement(
      mobile.Provider,
      { value: isMobile },
      React.createElement(TitleContainer, { toggleDueDate: noop }),
    ),
  );

test("the ticket header shows no agent status chip on desktop or phone, even when the ticket carries a running agent", () => {
  for (const isMobile of [false, true]) {
    const html = render(isMobile);
    assert.match(html, /data-part="title"/, "the header still renders the title");
    assert.doesNotMatch(html, /agent-status-chip/);
    assert.doesNotMatch(html, /RUNNER 9: /);
  }
});

test("the ticket header no longer depends on the agent pulse chip module or its flag", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/PageComponents/TaskDetail/TopRow/TaskDetailTitleContainer.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /TaskDetailAgentStatusChip/);
  assert.doesNotMatch(source, /htpr-7339-agent-pulse-dot/);
  assert.equal(
    fs.existsSync(path.join(root, "src/lib/agentStatus/TaskDetailAgentStatusChip.tsx")),
    false,
    "the ticket-header chip component is gone",
  );
});

test("the board card keeps its agent status chip and pulse dot", () => {
  const source = fs.readFileSync(
    path.join(root, "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTagsRow.tsx"),
    "utf8",
  );
  assert.match(source, /import AgentStatusChip from '@\/lib\/agentStatus\/AgentStatusChip'/);
  assert.match(source, /pulseDot/);
  assert.match(source, /data-testid="agent-status-chip"/);
  assert.equal(fs.existsSync(path.join(root, "src/lib/agentStatus/AgentStatusDot.tsx")), true);
});
