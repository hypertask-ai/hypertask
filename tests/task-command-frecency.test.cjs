const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);

const taskContext = {
  context: "Task",
  taskOptions: {
    isApple: false,
    isArchived: false,
    hasNotifications: false,
    isKanban: true,
    hasSubtasks: false,
    hasParent: false,
    isStarred: false,
    timeTrackingEnabled: false,
  },
  commentOptions: {
    isApple: false,
    isCurrentUserCreator: false,
    isPinned: false,
    isStarred: false,
  },
};

const setMock = (filename, exports) => {
  const previous = require.cache[filename];
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
  return () => {
    if (previous === undefined) delete require.cache[filename];
    else require.cache[filename] = previous;
  };
};

const { recordHTCCommandUsage } = createJiti(__filename)(
  modulePath("src/components/Modals/commands/HTC/htcFrecency.ts"),
);

test("command usage updates immutably and keeps the archive toggle excluded", () => {
  const existing = {
    createTask: {
      key: "createTask",
      name: "Create task",
      commandMode: 1,
      frequency: 2,
      lastUsedAt: 100,
    },
  };
  const deleteComment = {
    key: "deletemessage",
    name: "Delete comment",
    commandMode: 2,
  };

  const firstUse = recordHTCCommandUsage(existing, deleteComment, 200);
  const secondUse = recordHTCCommandUsage(firstUse, deleteComment, 300);

  assert.notStrictEqual(firstUse, existing);
  assert.deepEqual(existing, {
    createTask: {
      key: "createTask",
      name: "Create task",
      commandMode: 1,
      frequency: 2,
      lastUsedAt: 100,
    },
  });
  assert.deepEqual(secondUse.deletemessage, {
    ...deleteComment,
    frequency: 2,
    lastUsedAt: 300,
  });

  const archiveToggle = {
    key: "toggleArchivedOnBoard",
    name: "Show archived tasks",
    commandMode: 3,
  };
  assert.strictEqual(
    recordHTCCommandUsage(secondUse, archiveToggle, 400),
    secondUse,
  );
});

test("task comment commands remember usage and rank within their group", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://app.hypertask.ai/detail/project-15/5971",
  });
  const globalNames = [
    "window",
    "document",
    "HTMLElement",
    "React",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previousGlobals = new Map(
    globalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(global, name),
    ]),
  );
  const previousScssLoader = require.extensions[".scss"];
  const cleanups = [];
  let reactRoot;
  let savedUsage = {
    editcomment: {
      key: "editcomment",
      name: "Edit comment",
      commandMode: 1,
      frequency: 100,
      lastUsedAt: Date.now(),
    },
  };

  const initialUsage = savedUsage;
  const atoms = {
    boardLayoutAtom: { default: "board" },
    calendarSettingsAtom: { default: { showWeekends: true } },
    currentProjectAtom: { default: null },
    frequentlyUsedHTCAton: { default: savedUsage },
    tableTitleWrapAtom: { default: false },
  };

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.React = React;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    require.extensions[".scss"] = (module) => {
      module.exports = {};
    };

    cleanups.push(
      setMock(modulePath("src/store/index.ts"), atoms),
      setMock(modulePath("src/lib/state.tsx"), {
        useRecoilState: (atom) => {
          const [value, setValue] = React.useState(
            atom === atoms.frequentlyUsedHTCAton ? savedUsage : atom.default,
          );
          const setPersistedValue = (next) => {
            setValue((previous) => {
              const result = typeof next === "function" ? next(previous) : next;
              if (atom === atoms.frequentlyUsedHTCAton) savedUsage = result;
              return result;
            });
          };
          return [value, setPersistedValue];
        },
        useRecoilValue: (atom) => atom.default,
      }),
      setMock(require.resolve("next/navigation"), {
        usePathname: () => "/detail/project-15/5971",
      }),
      setMock(require.resolve("reactstrap"), {
        ModalBody: ({ children }) => React.createElement("div", null, children),
      }),
      setMock(
        modulePath("src/components/Common/CommonModalComponents/index.tsx"),
        {
          ModalContainerCustom: ({ children, isOpen }) =>
            isOpen ? React.createElement("div", null, children) : null,
          ModalHintBar: () => null,
          ModalInput: (props) =>
            React.createElement("input", {
              ...props,
              autoFocus: false,
              ref: () => {},
            }),
        },
      ),
      setMock(
        modulePath("src/components/Modals/commands/HTC/CommandGroup.tsx"),
        {
          __esModule: true,
          default: ({ filterCommands, onClickHandler }) =>
            React.createElement(
              "div",
              null,
              filterCommands.map((group) =>
                React.createElement(
                  "section",
                  { key: group.group, "data-group": group.group },
                  React.createElement("h2", null, group.group),
                  group.commandLists.map((command) =>
                    React.createElement(
                      "button",
                      {
                        key: command.key,
                        "data-command": command.key,
                        onClick: () => onClickHandler(command),
                      },
                      command.name,
                    ),
                  ),
                ),
              ),
            ),
        },
      ),
      setMock(modulePath("src/hooks/MultiPages/HTC/useHTC.tsx"), {
        __esModule: true,
        default: (commandGroups) => ({
          keyword: "",
          onKeyChange: () => {},
          selectedCommand: null,
          filterCommands: commandGroups,
          handleCommandSelect: () => {},
          hoveredGroup: 0,
          setHoveredGroupIndex: () => {},
          setCurrentCommandIndex: () => {},
          currentCommandIndex: 0,
          setSelectedCommand: () => {},
        }),
      }),
      setMock(
        modulePath("src/hooks/RecoilRoot/useHypertasksRecoilStates.ts"),
        { __esModule: true, default: () => ({ resetShowCommands: () => {} }) },
      ),
      setMock(
        modulePath(
          "src/utils/helperFunctions/Views/ViewsHelperFunctions.ts",
        ),
        {
          getActiveEmptySectionSettingFromProject: () => "Shown",
          getActiveStalenessFromProject: () => false,
        },
      ),
      setMock(
        modulePath(
          "src/components/PageComponents/Interactive-Onboarding/Components/TutorialTip.tsx",
        ),
        { __esModule: true, default: () => null },
      ),
      setMock(modulePath("src/lib/contexts/TourContext.tsx"), {
        useTourContext: () => ({ endTour: () => {} }),
      }),
      setMock(
        modulePath("src/hooks/MultiPages/useGetAllProjectsMinimal.ts"),
        { useGetAllProjectsMinimal: () => ({ data: [] }) },
      ),
      setMock(modulePath("src/lib/contexts/mobileContext.tsx"), {
        MobileViewContext: React.createContext(false),
      }),
      setMock(modulePath("src/components/Modals/Sheets/index.ts"), {
        MobileBottomSheet: ({ children }) => React.createElement("div", null, children),
      }),
    );

    const jiti = createJiti(__filename, {
      alias: { "@": path.join(root, "src") },
      interopDefault: true,
      jsx: true,
    });
    const Commands = jiti(
      modulePath("src/components/Modals/commands/HTC/commands.tsx"),
    ).default;
    const renderPalette = () =>
      React.createElement(Commands, {
        isOpen: true,
        contextOptions: taskContext,
        handleAction: () => {},
      });
    const container = document.getElementById("root");
    reactRoot = createRoot(container);

    await React.act(async () => reactRoot.render(renderPalette()));
    assert.equal(container.querySelector('[data-command="editcomment"]'), null);
    assert.equal(container.querySelector('[data-group="Frequently used"]'), null);

    for (let use = 0; use < 5; use += 1) {
      await React.act(async () => {
        container.querySelector('[data-command="deletemessage"]').click();
      });
    }
    assert.equal(savedUsage.deletemessage.frequency, 5);
    assert.notStrictEqual(savedUsage, initialUsage);
    assert.equal(initialUsage.deletemessage, undefined);

    await React.act(async () => reactRoot.render(null));
    await React.act(async () => reactRoot.render(renderPalette()));

    const commentCommands = Array.from(
      container.querySelectorAll('[data-group="Comment"] [data-command]'),
    ).map((element) => element.dataset.command);
    assert.equal(commentCommands[0], "deletemessage");
    assert.equal(commentCommands.includes("editcomment"), false);
    assert.equal(container.querySelector('[data-group="Frequently used"]'), null);
  } finally {
    try {
      if (reactRoot) await React.act(async () => reactRoot.unmount());
    } finally {
      for (const cleanup of cleanups.reverse()) cleanup();
      if (previousScssLoader === undefined) delete require.extensions[".scss"];
      else require.extensions[".scss"] = previousScssLoader;
      dom.window.close();
      for (const [name, descriptor] of previousGlobals) {
        if (descriptor === undefined) delete global[name];
        else Object.defineProperty(global, name, descriptor);
      }
    }
  }
});
