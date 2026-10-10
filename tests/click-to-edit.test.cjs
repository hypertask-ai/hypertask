const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createPortal } = require("react-dom");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const base = "src/components/PageComponents/TaskDetail/CommentAndDescription/";
function compile(file, mocks = {}, source = fs.readFileSync(path.join(root, file), "utf8")) {
  const exports = {};
  const js = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("require", "exports", js)((name) => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    return "default" in mocks[name] ? { __esModule: true, ...mocks[name] } : mocks[name];
  }, exports);
  return exports;
}
const editTarget = compile("src/lib/taskDetailEditTarget.ts");
const doubleTap = compile("src/hooks/MultiPages/useDoubleTap.ts");
const guestEdit = compile("src/lib/demo/guestDescriptionEdit.ts");
const EditCommentButton = compile(`${base}CommentContainer/CommentOptions/EditCommentButton.tsx`, {
  "lucide-react": { Pencil: (props) => React.createElement("svg", { ...props, "data-control": "edit" }) },
  "@/components/Common/Tooltip": { default: () => null },
}).default;
const globalStates = fs.readFileSync(path.join(root, "src/hooks/Task Detail/useTaskDetailGlobalStates.ts"), "utf8");
const descriptionAction = globalStates.slice(
  globalStates.indexOf("  const editDescriptionHandler ="),
  globalStates.indexOf("  // ------------------ [ENTER]"),
);
assert.match(descriptionAction, /setEditMode\(editModeToSelect\)/);
const { createDescriptionEditAction } = compile("description-action.ts", {}, `
  export function createDescriptionEditAction(context) {
    const { editMode, setEditMode, focusOn } = context;
    const descriptionContainerId = "description-container";
    ${descriptionAction}
    return editDescriptionHandler;
  }
`);

async function mount(t, { surface, mobile = false, enabled = true, guest = false, collapsed = false }) {
  const dom = new JSDOM("<div id='root'></div><div id='portal'></div>", { url: "https://example.test/" });
  const globals = ["window", "document", "Element", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = globals.map((name) => global[name]);
  Object.assign(global, { window: dom.window, document: dom.window.document, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const reactRoot = createRoot(document.getElementById("root"));
  t.after(async () => {
    await React.act(async () => reactRoot.unmount());
    globals.forEach((name, index) => { global[name] = previous[index]; });
    dom.window.close();
  });
  const Task = React.createContext(null);
  const Mobile = React.createContext(mobile);
  let task;
  let rowCollapsed = collapsed;
  let commentId = "42";
  const actions = [];
  const edits = [];
  let guestRequests = 0;
  dom.window.addEventListener(guestEdit.GUEST_DESCRIPTION_EDIT_REQUEST_EVENT, () => { guestRequests += 1; });
  function Provider({ children }) {
    const [editMode, setEditMode] = React.useState(null);
    const [editState, setEditState] = React.useState(null);
    const [currentId, setCurrentId] = React.useState("");
    task = { editMode, setEditMode, editState, setEditState, currentId, setCurrentId,
      newCommentIds: [], currentTask: { id: 42 }, focusOn: () => {}, setCarousalItems: () => {} };
    return React.createElement(Task.Provider, { value: task }, children);
  }
  const editCommentHandler = (index) => { edits.push(index); task.setEditState(index); };
  const Controls = () => React.createElement("div", { "data-task-detail-actions": true },
    ...["emoji", "reaction", "copy", "menu", "reply"].map((name) =>
      React.createElement("span", { key: name, "data-control": name, onClick: (event) => {
        actions.push(name);
        if (name === "copy") event.stopPropagation();
      } }, React.createElement("svg", null, React.createElement("path", { "data-icon": name })))),
    surface === "comment"
      ? React.createElement(EditCommentButton, { currentIndex: 0, onClickHandler: editCommentHandler })
      : React.createElement("button", { "data-control": "edit", onClick: () => createDescriptionEditAction(task)() }, "Edit description"),
    createPortal(React.createElement("span", { "data-task-detail-actions": true, "data-control": "portal", onClick: () => actions.push("portal") }, "picker"), document.getElementById("portal")),
    createPortal(React.createElement("div", { "data-control": "portal-loading", onClick: () => actions.push("portal-loading") }, "Loading emoji\u2026"), document.getElementById("portal")));
  const Text = () => React.createElement("div", { id: surface === "comment" ? "comment-0-input" : "description-input" },
    React.createElement("p", { "data-text": true }, "Selectable text"),
    React.createElement("a", { href: "#linked", "data-link": true }, React.createElement("strong", null, "Link")),
    React.createElement("button", { "data-control": "button", onClick: () => actions.push("button") }, "Control"),
    React.createElement("div", { role: "button", "data-control": "role", onClick: () => actions.push("role") }, React.createElement("span", null, "Custom control")),
    React.createElement("img", { "data-control": "image" }),
    React.createElement("div", { contentEditable: true, suppressContentEditableWarning: true, "data-control": "editor" }, "Editor"));
  const mocks = {
    "@/lib/contexts/TaskDetail/TaskProvider": { useTaskContext: () => React.useContext(Task) },
    "@/lib/contexts/mobileContext": { MobileViewContext: Mobile },
    "@/hooks/useFlag": { useFlag: (key) => key === "htpr-7044-double-click-to-edit" ? enabled : false },
    "@/lib/flags/keys": { HTPR_7044_DOUBLE_CLICK_TO_EDIT_FLAG: "htpr-7044-double-click-to-edit", HTPR_6752_INSTANT_TICKET_OPEN_FLAG: "instant" },
    "@/lib/taskDetailEditTarget": editTarget,
    "@/hooks/MultiPages/useDoubleTap": doubleTap,
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container", DELIBERATE_DOUBLE_CLICK_MS: 500 },
    "@/lib/state": { useRecoilState: () => [{ id: 7 }, () => {}], useRecoilValue: () => ({ id: 7 }) },
    "@/store": { currentUserAtom: {}, currentProjectAtom: {}, showCommandsAtom: {} },
    "@/lib/demo/guest": { isGuestUser: () => guest },
    "@/lib/demo/guestDescriptionEdit": guestEdit,
    "@/lib/contexts/CommentsContext": { useCommentsContext: () => ({ comment: { id: commentId, creator: { id: 7 } }, i: 0, isStacked: rowCollapsed }) },
    "@/lib/contexts/TaskDetail/DescriptionProvider": { useDescriptionAndCommentsContext: () => ({
      updateStackedComments: () => { rowCollapsed = false; }, editCommentHandler, replyToCommentHandler: () => actions.push("reply"),
    }) },
    "@/styles/tiptap.module.scss": {},
    "@/components/Common/AttachmentsView": { default: () => null },
    "@/models/enums": { CommandMode: { Command: "command" } },
    "@/lib/htc/isCommentCreatedByUser": { isCommentCreatedByUser: () => true },
    "lucide-react": { Reply: () => null },
    "next/dynamic": { default: () => Controls },
    "./CommentBodyDesktop": { default: ({ children }) => children },
    "./CommentCreatedBy": { default: () => null },
    "./CommentText": { default: Text },
    "./CommentOptions": { CommentOptions: Controls },
    "./CommentTaskActivity": { default: () => null },
    "./CommentOptions/ReplyToComment": { default: () => null },
    "./SwipeableCommentRow": { default: ({ children }) => children },
  };
  const file = surface === "comment" ? `${base}CommentContainer/CommentsContainer.tsx` : `${base}DescriptionContainer/index.tsx`;
  const Container = compile(file, mocks).default;
  const render = () => React.act(async () => reactRoot.render(
    React.createElement(Provider, null, React.createElement(Container, null, React.createElement(Text), React.createElement(Controls))),
  ));
  await render();
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  let timestamp = 1000;
  const find = (selector) => document.querySelector(selector);
  const emit = async (target, type, detail = 1) => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, detail });
    Object.defineProperty(event, "timeStamp", { value: timestamp += 10 });
    await React.act(async () => target.dispatchEvent(event));
    return event;
  };
  const tick = (ms) => React.act(async () => { timestamp += ms; t.mock.timers.tick(ms); });
  const click = async (target, detail = 1) => {
    await emit(target, "mousedown", detail);
    return emit(target, "click", detail);
  };
  const doubleClick = async (target) => {
    await click(target);
    await click(target, 2);
    await emit(target, "dblclick", 2);
    await tick(101);
  };
  return { find, click, doubleClick, emit, tick, render, actions, edits, task: () => task,
    guestRequests: () => guestRequests, setCommentId: (id) => { commentId = id; },
    edited: () => edits.length > 0 || task.editMode === "description" };
}

for (const surface of ["comment", "description"]) {
  for (const mobile of [false, true]) {
    test(`${surface}: ${mobile ? "phone" : "desktop"} text stays read-only on one click and edits on two`, async (t) => {
      const h = await mount(t, { surface, mobile });
      const text = h.find("[data-text]");
      const range = document.createRange();
      range.selectNodeContents(text);
      window.getSelection().addRange(range);
      const event = await h.click(text);
      assert.equal(event.defaultPrevented, false);
      await h.tick(250);
      assert.equal(h.edited(), false);
      assert.equal(window.getSelection().toString(), "Selectable text");
      const linkClick = await h.click(h.find("[data-link] strong"));
      assert.equal(linkClick.defaultPrevented, false);
      assert.equal(h.edited(), false);
      await h.tick(250);
      await h.doubleClick(text);
      assert.equal(h.edited(), true);
      if (surface === "comment") assert.equal(h.edits.length, 1);
    });

    test(`${surface}: ${mobile ? "phone" : "desktop"} controls, nested icons, portal picker and links never edit`, async (t) => {
      const h = await mount(t, { surface, mobile });
      if (!mobile) {
        await h.click(h.find("[data-icon='menu']"));
        assert.equal(h.task().currentId, surface === "comment" ? "comment-0" : "description-container", "menu actions must retain the clicked row as their target");
        assert.equal(h.edited(), false);
      }
      for (const selector of ["[data-icon='emoji']", "[data-control='reaction']", "[data-icon='copy']", "[data-icon='menu']", "[data-icon='reply']", "[data-control='portal']", "[data-control='portal-loading']", "[data-link] strong", "[data-control='button']", "[data-control='role'] span", "[data-control='image']", "[data-control='editor']"]) {
        const target = h.find(selector);
        assert.ok(target, selector);
        await h.doubleClick(target);
        assert.equal(h.edited(), false, selector);
        await h.tick(250);
      }
      for (const name of ["emoji", "reaction", "copy", "menu", "reply", "portal", "button", "role"]) assert.ok(h.actions.includes(name), name);
    });

    test(`${surface}: ${mobile ? "phone" : "desktop"} explicit Edit remains usable`, async (t) => {
      const h = await mount(t, { surface, mobile });
      await h.click(h.find("[data-control='edit']"));
      await h.tick(101);
      if (surface === "comment") assert.deepEqual(h.edits, [0]);
      else assert.equal(h.task().editMode, "description");
    });
  }

  test(`${surface}: a phone control tap cannot pair with a preceding or following text tap`, async (t) => {
    const h = await mount(t, { surface, mobile: true });
    await h.click(h.find("[data-text]"));
    await h.click(h.find("[data-control='menu']"));
    await h.click(h.find("[data-text]"));
    await h.tick(250);
    assert.equal(h.edited(), false);
  });

  test(`${surface}: a phone control click followed by text and native double click never edits`, async (t) => {
    const h = await mount(t, { surface, mobile: true });
    await h.click(h.find("[data-icon='emoji']"));
    await h.click(h.find("[data-text]"), 2);
    await h.emit(h.find("[data-text]"), "dblclick", 2);
    await h.tick(250);
    assert.equal(h.edited(), false);
  });

  test(`${surface}: slow desktop clicks do not bypass the deliberate interval`, async (t) => {
    const h = await mount(t, { surface });
    const text = h.find("[data-text]");
    await h.click(text);
    await h.tick(600);
    await h.click(text, 2);
    await h.emit(text, "dblclick", 2);
    await h.tick(101);
    assert.equal(h.edited(), false);
  });

  test(`${surface}: a desktop sequence that began on a control cannot edit text`, async (t) => {
    const h = await mount(t, { surface });
    await h.click(h.find("[data-icon='emoji']"));
    await h.click(h.find("[data-text]"), 2);
    await h.emit(h.find("[data-text]"), "dblclick", 2);
    await h.tick(101);
    assert.equal(h.edited(), false);
  });

  for (const mobile of [false, true]) {
    test(`${surface}: flag off retains the old unguarded ${mobile ? "phone tap" : "desktop double-click"} behavior`, async (t) => {
      const h = await mount(t, { surface, mobile, enabled: false });
      await h.doubleClick(h.find("[data-control='menu']"));
      assert.equal(h.edited(), true, "positive control must reproduce the existing event leak");
    });
  }
}

test("comments: collapsed opening press only expands, and a recycled row never edits", async (t) => {
  const h = await mount(t, { surface: "comment", collapsed: true });
  await h.doubleClick(h.find("[data-text]"));
  assert.equal(h.edited(), false);
  assert.equal(h.task().currentId, "comment-0");
  await h.render();
  await h.click(h.find("[data-text]"));
  h.setCommentId("43");
  await h.render();
  await h.click(h.find("[data-text]"), 2);
  await h.emit(h.find("[data-text]"), "dblclick", 2);
  assert.equal(h.edited(), false);
});

for (const enabled of [true, false]) {
  test(`guest descriptions: flag ${enabled ? "on" : "off"} retains single click and keeps the focus request`, async (t) => {
    const h = await mount(t, { surface: "description", guest: true, enabled });
    await h.click(h.find("[data-text]"));
    assert.equal(h.edited(), true, "the first guest click must enter editing synchronously");
    assert.equal(h.guestRequests(), 1);
    await h.click(h.find("[data-text]"), 2);
    await h.emit(h.find("[data-text]"), "dblclick", 2);
    assert.equal(h.guestRequests(), 1, "a double click must not request guest focus twice");
  });
}

test("guest descriptions: flag on rejects controls, nested icons, links and portal clicks before single-click editing", async (t) => {
  const h = await mount(t, { surface: "description", guest: true });
  for (const selector of ["[data-icon='emoji']", "[data-control='reaction']", "[data-icon='menu']", "[data-control='portal']", "[data-control='portal-loading']", "[data-link] strong", "[data-control='button']", "[data-control='role'] span", "[data-control='image']", "[data-control='editor']"]) {
    await h.doubleClick(h.find(selector));
    assert.equal(h.edited(), false, selector);
    assert.equal(h.guestRequests(), 0, selector);
  }
  await h.click(h.find("[data-text]"));
  assert.equal(h.edited(), true);
  assert.equal(h.guestRequests(), 1);
});

test("every existing hover/reaction region marks its non-semantic controls as actions", () => {
  for (const [file, count] of [
    ["CommentContainer/CommentOptions.tsx", 1],
    ["CommentContainer/CommentReactions.tsx", 2],
    ["DescriptionContainer/TopRow/DescriptionTopRight.tsx", 1],
    ["DescriptionContainer/BottomRow/DescriptionReactions.tsx", 2],
  ]) {
    assert.equal(fs.readFileSync(path.join(root, base, file), "utf8").split("data-task-detail-actions").length - 1, count, file);
  }
});
