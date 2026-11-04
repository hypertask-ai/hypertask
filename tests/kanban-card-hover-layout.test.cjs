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
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/definitions/htpr-8255-kanban-cleanup": { HTPR_8255_KANBAN_CLEANUP_FLAG: "htpr-8255-kanban-cleanup" },
    "@/lib/flags/definitions/htpr-7749-header-icon-size": { HTPR_7749_HEADER_ICON_SIZE_FLAG: "htpr-7749-header-icon-size" },
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
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/definitions/htpr-8255-kanban-cleanup": { HTPR_8255_KANBAN_CLEANUP_FLAG: "htpr-8255-kanban-cleanup" },
  },
);
const TaskDraggableContainer = loadComponent(
  "src/components/PageComponents/Kanban/KanbanTaskComponents/TaskDraggableContainer.tsx",
  {
    ...shared,
    "@/hooks/useFlag": { useFlag: () => false },
    "@/lib/flags/definitions/htpr-8255-kanban-cleanup": { HTPR_8255_KANBAN_CLEANUP_FLAG: "htpr-8255-kanban-cleanup" },
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

const { loader, mount } = require("./helpers/htpr-7260-ui.cjs");
const hoverFlagKey = "htpr-8629-kanban-hover-layout";
const hoverFlag = loader()(`src/lib/flags/definitions/${hoverFlagKey}.ts`);

test("hover layout bugfix defaults to everyone", () => {
  assert.equal(hoverFlag.default.key, hoverFlagKey);
  assert.equal(hoverFlag.default.kind, "bugfix");
  assert.equal(hoverFlag.default.defaultMode, "EVERYONE");
  assert.equal(hoverFlag.default.releaseRisk.risk, "small");
});

function loadCard(enabled, cleanup) {
  const cn = (...args) => twMerge(clsx(args));
  const flags = key => key === hoverFlagKey ? enabled : key === "htpr-8255-kanban-cleanup" && cleanup;
  const mocks = {
    ...shared,
    "@/hooks/useFlag": { useFlag: flags },
    "@/lib/flags/keys": {},
    "@/lib/flags/definitions/htpr-8629-kanban-hover-layout": hoverFlag,
    "@/lib/flags/definitions/htpr-8255-kanban-cleanup": { HTPR_8255_KANBAN_CLEANUP_FLAG: "htpr-8255-kanban-cleanup" },
    "@/lib/flags/definitions/htpr-7975-column-work-limits": {},
    "@/lib/firstScreen/SurfaceContext": { useFirstScreenSurface: () => null },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveStalenessFromProject: () => false },
    "@/utils/undoActions/helperFuncs": { cn },
    "next/link": { default: ({ prefetch, ...props }) => React.createElement("a", props) },
    "./CardSubTasks": { default: empty },
    "./TaskTagsRow": { default: empty },
    "./TaskTopRow": { default: TaskTopRow },
  };
  return loader(mocks)("src/components/PageComponents/Kanban/KanbanTaskComponents/KanbanTaskCard.tsx").default;
}

for (const enabled of [false, true]) {
  for (const cleanup of [false, true]) {
    test(`card selection and content layout: fix ${enabled}, cleanup ${cleanup}`, () => {
      const Card = loadCard(enabled, cleanup);
      const app = mount();
      const selections = [];
      let opened = 0;
      const props = {
        task: { id: 42, projectId: 15, uniqueIndex: 42, ticketNumber: "HTPR-42", title: "Example card", notifications: [{ seen: false }], _count: { notifications: 1 }, parentTask: { ticketNumber: "HTPR-1", title: "Parent card" } },
        currentSetting: "Flattened", assignedUsers: [], agentAssignees: [], active: false,
        hover: false, hasDraft: false, openDetail: () => opened++, onSelectionClick: (id, event) => selections.push([id, event.shiftKey]),
      };
      try {
        for (const state of [{}, { selected: true }, { selectionMode: true }]) {
          app.render(React.createElement(Card, { ...props, ...state }));
          const link = app.container.querySelector("a[href='/detail/project-15/42']");
          const button = app.container.querySelector("button[aria-label$='item']");
          const selecting = !!(state.selected || state.selectionMode);
          assert.ok(link.textContent.includes("HTPR-1: Parent card"));
          assert.ok(link.textContent.includes("HTPR-42"));
          assert.ok(link.textContent.includes("Example card"));
          assert.ok(link.querySelector(".task-ticket-id").parentElement.querySelector("svg"), "unread notification remains visible");
          assert.equal(link.classList.contains("group-hover/kanban-selection:pl-7"), !enabled);
          assert.equal(link.classList.contains("pl-7"), selecting);
          if (!selecting) assert.ok(link.classList.contains(cleanup ? "pl-3" : "p-2"));
          assert.equal(button.classList.contains("-left-2"), enabled && !selecting);
          assert.equal(button.classList.contains("left-2"), !enabled || selecting);
          assert.equal(button.style.width, "15px");
          React.act(() => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true })));
          assert.deepEqual(selections.at(-1), [42, true]);
          assert.equal(opened, 0, "selection must not open the card");
        }
      } finally {
        app.close();
      }
    });
  }
}
