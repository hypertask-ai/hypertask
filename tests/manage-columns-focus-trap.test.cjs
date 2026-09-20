const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
require("tsx/cjs");

const root = path.resolve(__dirname, "..");
const modulePath = (relativePath) => path.join(root, relativePath);

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

test("Manage columns enables the shared modal focus trap", () => {
  const currentProjectAtom = {};
  const currentUserAtom = {};
  const currentProject = { id: 1, tasks: [] };
  const section = { id: 10, section_title: "Todo", visibility: true };
  let modalProps;
  const cleanups = [];
  const element = (tag = "div") => ({ children }) =>
    React.createElement(tag, null, children);

  try {
    cleanups.push(
      setMock(modulePath("src/store/index.ts"), {
        currentProjectAtom,
        currentUserAtom,
      }),
      setMock(modulePath("src/lib/state.tsx"), {
        useRecoilState: (atom) =>
          atom === currentProjectAtom
            ? React.useState(currentProject)
            : React.useState(null),
        useRecoilValue: (atom) =>
          atom === currentUserAtom ? { id: 1 } : null,
      }),
      setMock(
        modulePath("src/components/Modals/AssignToUser/AssignToUser.tsx"),
        { __esModule: true, default: () => null },
      ),
      setMock(
        modulePath("src/hooks/MultiPages/useGetMembersForAssignees.ts"),
        { useGetAllMembersForAssign: () => ({ data: { members: [], owner: null } }) },
      ),
      setMock(require.resolve("lucide-react"), new Proxy({}, {
        get: () => element("span"),
      })),
      setMock(require.resolve("reactstrap"), {
        ModalBody: element(),
        ModalFooter: element(),
        ModalHeader: element(),
      }),
      setMock(require.resolve("nookies"), { parseCookies: () => ({}) }),
      setMock(require.resolve("@tanstack/react-query"), {
        useQueryClient: () => ({
          cancelQueries: async () => {},
          invalidateQueries: async () => {},
          refetchQueries: async () => {},
          setQueriesData: () => {},
          setQueryData: () => {},
        }),
      }),
      setMock(
        modulePath("src/hooks/MultiPages/useGetAllManageColumns.tsx"),
        { useGetAllManageColumns: () => ({ data: [section] }) },
      ),
      setMock(modulePath("src/lib/constants/index.ts"), {
        __esModule: true,
        default: { GetAllManageColumnsPrefixKey: "manage-columns" },
      }),
      setMock(require.resolve("@hello-pangea/dnd"), {
        DragDropContext: element(),
        Draggable: ({ children }) =>
          children({
            draggableProps: {},
            dragHandleProps: {},
            innerRef: () => {},
          }, {}),
        Droppable: ({ children }) =>
          children({
            droppableProps: {},
            innerRef: () => {},
            placeholder: null,
          }),
      }),
      setMock(
        modulePath("src/components/Common/CommonModalComponents/index.tsx"),
        {
          ModalContainerCustom: ({ children, ...props }) => {
            modalProps = props;
            return React.createElement("div", { role: "dialog" }, children);
          },
        },
      ),
      setMock(require.resolve("axios"), { post: async () => ({}) }),
      setMock(require.resolve("react-hot-toast"), {
        __esModule: true,
        default: { error: () => {} },
      }),
      setMock(modulePath("src/hooks/Homepage/Views/useKanbanViews.ts"), {
        __esModule: true,
        default: () => ({
          saveEmptySectionsAPI: () => {},
          setBoardColumnsViewAPI: async () => {},
        }),
      }),
      setMock(
        modulePath("src/utils/helperFunctions/Views/ViewsHelperFunctions.ts"),
        { getActiveEmptySectionSettingFromProject: () => "Hidden" },
      ),
      setMock(
        modulePath("src/utils/helperFunctions/Views/ColumnReorderHelper.ts"),
        {
          applyReorderedSectionsToProject: (project) => project,
          reorderSectionsWithRank: () => ({}),
        },
      ),
      setMock(
        modulePath("src/components/Modals/Common Modals/ConfirmDialog.tsx"),
        { __esModule: true, default: () => null },
      ),
      setMock(modulePath("src/lib/doneColumns.ts"), {
        isDoneByName: () => false,
      }),
      setMock(modulePath("src/lib/sectionAutoAssign.ts"), {
        applySectionAutoAssignToProject: (project) => project,
        hasNoSectionAutoAssign: () => true,
      }),
      setMock(
        modulePath("src/components/Modals/Settings/SettingsToggle.tsx"),
        {
          __esModule: true,
          default: () => React.createElement("button", { type: "button" }),
        },
      ),
      setMock(modulePath("src/hooks/useFlag.ts"), { useFlag: () => false }),
      setMock(modulePath("src/lib/flags/keys.ts"), {
        COLUMN_ALL_VIEWS_FLAG: "column-all-views",
      }),
      setMock(
        modulePath("src/utils/helperFunctions/Views/ColumnAllViewsHelper.ts"),
        {
          applyColumnVisibilityToProject: (project) => project,
          countViewsShowingColumn: () => ({ visible: 0, total: 0 }),
          describeViewsShowingColumn: () => "",
        },
      ),
      setMock(
        modulePath("src/components/Modals/commands/manageColumnTaskCounts.ts"),
        { getManageColumnRows: () => [{ section, taskCount: 0 }] },
      ),
    );

    const ManageColumns = require(
      modulePath("src/components/Modals/commands/manageColumn.tsx"),
    ).default;

    const html = renderToStaticMarkup(
      React.createElement(ManageColumns, { toggleModal: () => {} }),
    );

    assert.equal(
      modalProps.trapFocus,
      true,
      "Tab and Shift+Tab must stay within Manage columns",
    );
    assert.match(html, /aria-label="Reorder Todo"/);
    assert.match(html, /aria-label="Edit Todo"/);
    assert.match(html, /role="checkbox" aria-checked="true" aria-label="Hide Todo"/);
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup();
  }
});
