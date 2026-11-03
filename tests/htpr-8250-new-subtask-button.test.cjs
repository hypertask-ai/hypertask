const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { act } = React;
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flag = "htpr-8250-new-subtask-button";
const flagName = "HTPR_8250_NEW_SUBTASK_BUTTON_FLAG";
const flagFile = "src/lib/flags/definitions/htpr-8250-new-subtask-button.ts";
const modalFile = "src/components/Modals/SubtaskLinkingModal/SubtaskLinking.tsx";
let enabled = false;
const noop = () => {};
const box = ({ children }) => React.createElement("div", null, children);
const overrides = {
  "react": React,
  "reactstrap": { ModalBody: box },
  "react-hot-toast": { default: { promise: noop, success: noop, error: noop } },
  "@/hooks/useFlag": { useFlag: (key) => (key === flag ? enabled : false) },
  "@/hooks/RecoilRoot/useHypertasksRecoilStates": { default: () => ({ toggleCreateTaskGlobally: (options) => created.push(options) }) },
  "@/hooks/General/useDebounce": { default: () => noop },
  "@/hooks/General/useHandleKeydownBasic": { default: () => ({ setSelectedIndex: noop, selectedIndex: 0, handleKeydown: noop }) },
  "@/hooks/General/useHandleMouse": { default: () => ({ handleMouseEnter: noop, handleMouseLeave: noop, handleMouseMove: noop, elRef: { current: null } }) },
  "@/lib/constants": { default: { addParentTaskRoute: "/api/tasks/add-parent", getOrphanTasksRoute: "/api/tasks/orphans" } },
  "@/models/model": {},
  "@/components/Common/CommonModalComponents": {
    ModalContainerCustom: box,
    ModalHeaderComp: ({ header }) => React.createElement("div", null, header),
    ModalInput: (props) => React.createElement("input", { value: props.value, placeholder: props.placeholder, onChange: props.onChange }),
    ModalListContainer: box,
    ModalRowElementContainer: ({ children, onClick }) => React.createElement("li", { onClick: () => onClick?.(0) }, children),
  },
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const js = ts.transpileModule(read(file), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  new Function("require", "exports", "React", js)((specifier) => {
    if (overrides[specifier]) return { __esModule: true, ...overrides[specifier] };
    if (specifier.endsWith(".scss")) return {};
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` :
        path.relative(root, path.resolve(path.dirname(path.join(root, file)), specifier));
      const target = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]
        .find((candidate) => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
      assert.ok(target, specifier);
      return load(target);
    }
    return require(specifier);
  }, exports, React);
  return exports;
}
const Modal = load(modalFile).default;
const flagFiles = require("./helpers/flag-files.cjs");
let dom, reactRoot, closed;
const created = [];
const render = (component, props) => act(() => reactRoot.render(React.createElement(component, props)));
const parent = { id: 41, projectId: 15, section: "Bugs", sectionId: 4389, title: "Parent ticket", ticketNumber: "HTPR-8250" };
const props = () => ({ closeHandler: () => closed++, taskInfo: parent });
const button = () => document.getElementById("subtask-new-button");
const createRow = () => [...document.querySelectorAll("li")].find((row) => row.textContent.includes("Create sub-task"));

test.beforeEach(() => {
  enabled = false;
  created.length = 0;
  closed = 0;
  dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/detail/project-15/8250" });
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
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

test("New sub-task opens the create window for the parent task in one click", () => {
  enabled = true;
  render(Modal, props());
  assert.ok(button(), "the button shows without opening a menu");
  assert.equal(button().textContent.trim(), "New sub-task");
  act(() => button().dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(created.length, 1);
  assert.deepEqual(created[0], {
    sectionId: 4389,
    sectionTitle: "Bugs",
    position: "top",
    parentTask: { title: "Parent ticket", id: 41, ticketNumber: "HTPR-8250" },
    prefilledTitle: undefined,
  });
  assert.equal(closed, 1, "the search modal closes so the create window is visible");
});

test("with the flag off the button is absent and search stays the only entry", () => {
  render(Modal, props());
  assert.equal(button(), null);
  assert.ok(createRow(), "the existing create row still renders when nothing matches");
});

test("the existing create row keeps working while the button is shown", () => {
  enabled = true;
  render(Modal, props());
  assert.ok(createRow());
  act(() => createRow().dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(created.length, 1);
  assert.equal(created[0].parentTask.id, 41);
});
