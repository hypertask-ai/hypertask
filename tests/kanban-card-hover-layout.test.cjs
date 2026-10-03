const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { JSDOM } = require("jsdom");
const { clsx } = require("clsx");
const { twMerge } = require("tailwind-merge");

const root = path.resolve(__dirname, "..");
const MobileViewContext = React.createContext(false);
const empty = () => null;

function loadComponent(relativePath, stubs) {
  const filename = path.join(root, relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    // CommonJS emit keeps import locations; preserve ESM import hoisting.
    transformers: { before: [() => (source) => ts.factory.updateSourceFile(source, [
      ...source.statements.filter(ts.isImportDeclaration),
      ...source.statements.filter((statement) => !ts.isImportDeclaration(statement)),
    ])] },
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    loaded,
    loaded.exports,
    (request) => stubs[request] ?? createRequire(filename)(request),
  );
  return loaded.exports.default;
}

const shared = {
  "@/lib/contexts/mobileContext": { MobileViewContext },
  "@/lib/state": { useRecoilState: () => [null, empty] },
  "@/store": {},
  "@/components/Common/Tooltip": empty,
};
const HTCButton = loadComponent(
  "src/components/PageComponents/TaskDetail/TaskOptions/HTCButton.tsx",
  {
    ...shared,
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/hooks/MultiPages/HTC/useDarkMode": () => ({ effectiveTheme: "light" }),
    "@/models/enums": { CommandMode: { Command: "Command" } },
  },
);
const TaskTopRow = loadComponent(
  "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskTopRow.tsx",
  {
    ...shared,
    "next/dynamic": () => empty,
    "./CommentAndAssignees": loadComponent(
      "src/components/PageComponents/Kanban/KanbanTaskComponents/CommentAndAssignees.tsx",
      {},
    ),
    "./SubtaskCount": loadComponent(
      "src/components/PageComponents/Kanban/KanbanTaskComponents/SubtaskCount.tsx",
      {},
    ),
    "@/components/Common/UserAvatar": empty,
    "../../TaskDetail/TaskOptions/HTCButton": HTCButton,
  },
);
const TaskDraggableContainer = loadComponent(
  "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx",
  {
    ...shared,
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/keys": {},
    "@/utils/undoActions/helperFuncs": { cn: (...args) => twMerge(clsx(args)) },
  },
);

function renderRow(hover, mobile = false, overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(
      MobileViewContext.Provider,
      { value: mobile },
      React.createElement(TaskTopRow, {
        task: {},
        ticketNumber: "HTPR-6874",
        assignees: [],
        agentAssignees: [],
        notifications: [],
        countSubtasks: 0,
        subTaskSetting: "None",
        hover,
        ...overrides,
      }),
    ),
  );
}

for (const [name, overrides] of [
  ["plain card", {}],
  ["card with metadata", { countNotifications: 1, _count: 2, countSubtasks: 3, subTaskSetting: "Flattened" }],
]) {
  test(`${name} reserves the same Command button layout at rest and on hover`, () => {
    const rest = new JSDOM(renderRow(false, false, overrides));
    const hovered = new JSDOM(renderRow(true, false, overrides));
    try {
      const restButton = rest.window.document.querySelector('img[width="16"][height="16"]');
      const hoveredButton = hovered.window.document.querySelector('img[width="16"][height="16"]');
      assert.equal(restButton, null, "resting cards must not mount the Command button");
      assert.ok(hoveredButton, "the existing hover Command button must remain");
      const restSlot = rest.window.document.body.firstElementChild.children[1];
      const hoveredSlot = hoveredButton.parentElement.parentElement;
      assert.ok(restSlot, "resting cards must reserve a Command button slot");
      assert.equal(restSlot.tagName, "DIV");
      assert.equal(restSlot.className, hoveredSlot.className);
      for (const className of ["h-4", "w-[14px]", "shrink-0"]) {
        assert.ok(restSlot.classList.contains(className), `slot must retain ${className}`);
      }
      assert.doesNotMatch(restSlot.className, /overflow-(?:hidden|clip)/,
        "the slot must not clip the Command tooltip");
      assert.equal(restSlot.innerHTML, "");
      hoveredSlot.replaceChildren();
      assert.equal(rest.window.document.body.innerHTML, hovered.window.document.body.innerHTML,
        "only the slot contents may change, not dimensions, margins, borders, or row contents");
    } finally {
      rest.window.close();
      hovered.window.close();
    }
  });
}

test("mobile keeps the Command button absent in both hover states", () => {
  assert.equal(renderRow(false, true), renderRow(true, true));
  assert.doesNotMatch(renderRow(true, true), /<img/);
});

test("focused and selected containers do not introduce vertical borders or padding", () => {
  for (const blocked of [false, true]) {
    for (const state of [{}, { active: true }, { selected: true }, { active: true, selected: true }]) {
      const dom = new JSDOM(renderToStaticMarkup(React.createElement(TaskDraggableContainer, {
        active: false, blocked, taskHref: "/detail/project-15/6874", openDetail: empty,
        ...state,
        children: React.createElement(TaskTopRow, {
          task: {}, ticketNumber: "HTPR-6874", assignees: [], agentAssignees: [],
          notifications: [], countSubtasks: 0, hover: true,
        }),
      })));
      try {
        const card = dom.window.document.body.firstElementChild;
        assert.ok(card.classList.contains(blocked ? "border-l-[3px]" : "border-l-4"));
        assert.doesNotMatch(card.className, /(?:^|\s)(?:border(?:-[tyb])?(?:-\d+|-\[\d[^\]]*\])?|p[tyb]?-\S+)(?:\s|$)/);
        assert.equal(card.querySelector("a").className, "flex items-center p-2 gap-1.5 flex-wrap");
      } finally {
        dom.window.close();
      }
    }
  }
});
