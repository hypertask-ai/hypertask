const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flag = "htpr-8250-new-subtask-button";
const flagName = "HTPR_8250_NEW_SUBTASK_BUTTON_FLAG";
const flagFile = "src/lib/flags/definitions/htpr-8250-new-subtask-button.ts";
const modalFile = "src/components/Modals/SubtaskLinkingModal/SubtaskLinking.tsx";
const addParentRoute = "/api/tasks/add-parent";
let enabled = false;
let listed = [];
let posted = [];
let inputProps = null;
const created = [];
const noop = () => {};
const box = ({ children }) => React.createElement("div", null, children);
const container = (props) => {
  React.useEffect(() => { props.onOpened?.(); }, []);
  return React.createElement("div", null, props.children);
};
const stubs = {
  "reactstrap": { ModalBody: box },
  "react-hot-toast": { default: { promise: noop, success: noop, error: noop } },
  "@/hooks/useFlag": { useFlag: (key) => (key === flag ? enabled : false) },
  "@/hooks/RecoilRoot/useHypertasksRecoilStates": { default: () => ({ toggleCreateTaskGlobally: (options) => created.push(options) }) },
  "@/hooks/General/useDebounce": { default: () => noop },
  "@/hooks/General/useHandleMouse": { default: () => ({ handleMouseEnter: noop, handleMouseLeave: noop, handleMouseMove: noop, elRef: { current: null } }) },
  "@/lib/constants": { default: { addParentTaskRoute: addParentRoute, getOrphanTasksRoute: "/api/tasks/orphans" } },
  "@/models/model": {},
  "@/components/Common/CommonModalComponents": {
    ModalContainerCustom: container,
    ModalHeaderComp: ({ header }) => React.createElement("div", null, header),
    ModalInput: (props) => {
      inputProps = props;
      return React.createElement("input", { value: props.value, placeholder: props.placeholder });
    },
    ModalListContainer: box,
    ModalRowElementContainer: ({ children, onClick }) => React.createElement("li", { onClick: () => onClick?.(0) }, children),
  },
};
const Modal = loadModule(modalFile, stubs).default;
const flagFiles = require("./helpers/flag-files.cjs");
let dom, reactRoot, closed;
const render = async (component, props) => {
  await act(async () => {
    reactRoot.render(React.createElement(component, props));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const parent = { id: 41, projectId: 15, section: "Bugs", sectionId: 4389, title: "Parent ticket", ticketNumber: "HTPR-8250" };
const props = () => ({ closeHandler: () => closed++, taskInfo: parent });
const rows = () => [...document.querySelectorAll("li")];
const createRow = () => rows().find((row) => /create/i.test(row.textContent));
const tasks = [
  { id: 11, ticketNumber: "MIFI-2", title: "First linkable task" },
  { id: 12, ticketNumber: "MIFI-3", title: "Second linkable task" },
];

global.fetch = async (url, options) => {
  if (options?.method === "POST") {
    posted.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ json: {} }) };
  }
  return { ok: true, json: async () => ({ json: listed }) };
};

test.beforeEach(async () => {
  enabled = false;
  listed = [];
  posted = [];
  inputProps = null;
  created.length = 0;
  closed = 0;
  dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/detail/project-15/8250" });
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.Element.prototype.scrollIntoView = noop;
  reactRoot = createRoot(document.getElementById("root"));
});
test.afterEach(() => { act(() => reactRoot.unmount()); dom.window.close(); });

test("flag file declares the ticket key with an Everyone feature default", () => {
  assert.match(read(flagFile), new RegExp(`export const ${flagName} = "${flag}"`));
  const definition = flagFiles.definitions().find((entry) => entry.key === flag);
  assert.ok(definition, "flag definition is loaded by the shared index");
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.match(definition.shippedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(definition.description.length > 20);
  assert.ok(definition.releaseRisk.reason.length > 20);
});

test("the modal reads the flag on a changed line", () => {
  assert.match(read(modalFile), new RegExp(`useFlag\\(${flagName}\\)`));
});

test("with the flag on the create row leads a populated list and opens the create window", async () => {
  enabled = true;
  listed = tasks;
  await render(Modal, props());
  assert.equal(rows().length, 3, "one create row plus both linkable tasks");
  assert.equal(createRow(), rows()[0], "the create row is the first row");
  assert.equal(createRow().textContent.trim(), "+ Create new sub-task");
  act(() => createRow().dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.deepEqual(created, [{
    sectionId: 4389,
    sectionTitle: "Bugs",
    position: "top",
    parentTask: { title: "Parent ticket", id: 41, ticketNumber: "HTPR-8250" },
    prefilledTitle: undefined,
  }]);
  assert.equal(closed, 1, "the search window closes so the create window is visible");
});

test("the create row is selected, so Enter on a populated list creates instead of linking", async () => {
  enabled = true;
  listed = tasks;
  await render(Modal, props());
  act(() => dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter" })));
  assert.equal(created.length, 1);
  assert.deepEqual(posted, [], "Enter does not link the first listed task");
});

test("typing keeps the create row first and names the text", async () => {
  enabled = true;
  listed = tasks;
  await render(Modal, props());
  assert.equal(rows()[0].textContent.trim(), "+ Create new sub-task");
  await act(async () => {
    inputProps.onChange({ target: { value: "release" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.equal(rows()[0].textContent.trim(), 'Create sub-task "release"');
});

test("linking a listed task still posts the task as the new sub-task", async () => {
  enabled = true;
  listed = tasks;
  await render(Modal, props());
  act(() => rows()[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.deepEqual(posted, [{ orphanId: 11, parentId: 41 }]);
  assert.deepEqual(created, []);
});

test("with the flag off the create row stays hidden behind an empty search", async () => {
  listed = tasks;
  await render(Modal, props());
  assert.equal(rows().length, 2, "only the two linkable tasks render");
  assert.equal(createRow(), undefined);
  act(() => rows()[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.deepEqual(posted, [{ orphanId: 11, parentId: 41 }]);
});
