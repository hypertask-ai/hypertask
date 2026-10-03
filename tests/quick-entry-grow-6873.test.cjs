const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const key = "htpr-6873-quick-entry-grow";

test("quick-entry growth uses its own registered flag and the shared board/table component", () => {
  assert.match(read("src/lib/flags/keys.ts"), /HTPR_6873_QUICK_ENTRY_GROW_FLAG = "htpr-6873-quick-entry-grow"/);
  assert.match(read("src/lib/flags.ts"), /key: HTPR_6873_QUICK_ENTRY_GROW_FLAG,\s*shippedOn: "2026-10-03"/);
  for (const file of [
    "src/components/PageComponents/Kanban/KanbanSectionComponents/section.tsx",
    "src/components/PageComponents/Kanban/TableView/TableCreateTaskControl.tsx",
  ]) assert.match(read(file), /<NewTask\s/);
});

test("quick-entry growth preserves single-line titles and existing create/cancel behavior", async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div><button id='outside'>Outside</button>", { url: "http://localhost" });
  const globals = ["window", "document", "navigator", "HTMLElement", "getComputedStyle", "ResizeObserver", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  let resizeCallback;
  let disconnected = 0;
  for (const name of globals) Object.defineProperty(global, name, {
    configurable: true,
    value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "getComputedStyle" ? () => ({ lineHeight: "20px" }) : name === "ResizeObserver" ? class {
      constructor(callback) { resizeCallback = callback; }
      observe() {}
      disconnect() { disconnected++; }
    } : dom.window[name],
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  let width = 240;
  Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "clientWidth", { get: () => width });
  Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "scrollHeight", {
    get() { return Math.max(1, Math.ceil(this.value.length / (width / 8))) * 20; },
  });
  let enabled = true;
  let title = "";
  let setTitle;
  let cancels = 0;
  let creates = [];
  let result = true;
  let resolveCreate;
  let pending = false;
  const inputRef = { current: null };
  const toasts = [];
  const mocks = {
    "@/hooks/useFlag": { useFlag: (flag) => { assert.equal(flag, key); return enabled; } },
    "@/lib/flags/keys": { HTPR_6873_QUICK_ENTRY_GROW_FLAG: key },
    "@/lib/configs/general.config": { MOBILE_TARGET: read("src/lib/configs/general.config.ts").match(/export const MOBILE_TARGET =\s*"([^"]+)"/)[1] },
    "react-hot-toast": { default: (message) => toasts.push(message) },
  };
  const compiled = ts.transpileModule(read("src/components/Common/newTask.tsx"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (specifier) => mocks[specifier] ? { __esModule: true, ...mocks[specifier] } : require(specifier), loaded, loaded.exports,
  );
  const NewTask = loaded.exports.default;
  const Harness = () => {
    [title, setTitle] = React.useState("");
    const [open, setOpen] = React.useState(true);
    return open && React.createElement(NewTask, {
      title, onTitleChange: setTitle, inputRef,
      onCancelCreate: () => { cancels++; setTitle(""); setOpen(false); },
      invokeCreateItem: async (...args) => {
        creates.push(args);
        if (pending) return new Promise((resolve) => { resolveCreate = resolve; });
        if (result instanceof Error) throw result;
        return result;
      },
    });
  };
  const { createRoot } = require("react-dom/client");
  const reactRoot = createRoot(document.getElementById("root"));
  let revision = 0;
  const mount = async () => React.act(async () => reactRoot.render(React.createElement(Harness, { key: ++revision })));
  const area = () => document.querySelector("textarea");
  const buttons = () => [...document.querySelectorAll("#root button")];
  const event = async (target, type, options = {}) => React.act(async () => target.dispatchEvent(new dom.window[type === "keydown" ? "KeyboardEvent" : "MouseEvent"](type, { bubbles: true, cancelable: true, ...options })));
  const fill = async (value) => React.act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(area(), value);
    area().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  try {
    await mount();
    await t.test("grows, caps at eight lines, shrinks and recalculates when width changes", async () => {
      assert.equal(area().style.height, "20px");
      await fill("a".repeat(100));
      assert.equal(area().style.height, "80px");
      await fill("a".repeat(1000));
      assert.equal(area().style.height, "160px");
      assert.equal(area().style.maxHeight, "160px");
      assert.ok(area().scrollHeight > 160);
      assert.ok(area().classList.contains("overflow-y-auto"));
      await fill("a".repeat(100));
      width = 120;
      await React.act(async () => resizeCallback());
      assert.equal(area().style.height, "140px");
      await fill("Short");
      assert.equal(area().style.height, "20px");
      assert.equal(inputRef.current, area());
      width = 240;
    });
    await t.test("pasted newlines become spaces and long unbroken text wraps", async () => {
      await fill("First\r\nSecond\nThird");
      assert.equal(title, "First Second Third");
      assert.equal(area().style.overflowWrap, "anywhere");
      assert.equal(area().rows, 1);
    });
    await t.test("desktop/mobile controls match approved tokens and touch targets", () => {
      assert.equal(buttons()[0].textContent, "Create task");
      for (const button of buttons()) {
        for (const token of ["h-7", "min-h-[44px]", "sm:min-h-0", "rounded-sm"]) assert.ok(button.classList.contains(token));
      }
      for (const token of ["bg-white-black", "text-white-black-inverted", "px-2.5", "text-content", "font-medium"]) assert.ok(buttons()[0].classList.contains(token));
      assert.equal(buttons()[1].getAttribute("aria-label"), "Close quick entry");
      assert.ok(buttons()[1].querySelector("svg.lucide-x"));
    });
    await t.test("Enter and Shift+Enter submit trimmed titles and reset growth", async () => {
      for (const shiftKey of [false, true]) {
        await fill("  Enter title  ");
        await event(area(), "keydown", { key: "Enter", shiftKey });
        assert.deepEqual(creates.at(-1), ["Enter title", true]);
        assert.equal(title, "");
        assert.equal(area().style.height, "20px");
      }
    });
    await t.test("composition Enter is ignored and empty titles do not submit", async () => {
      const before = creates.length;
      await fill("Composing");
      await event(area(), "keydown", { key: "Enter", isComposing: true });
      await fill("  ");
      await event(area(), "keydown", { key: "Enter" });
      assert.equal(creates.length, before);
      assert.equal(toasts.at(-1), "Cannot create tasks with empty title");
    });
    await t.test("button mousedown cannot blur-cancel; click shares Enter submission", async () => {
      await fill("Button title");
      const down = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true });
      await React.act(async () => buttons()[0].dispatchEvent(down));
      assert.equal(down.defaultPrevented, true);
      assert.equal(cancels, 0);
      await event(buttons()[0], "click");
      assert.deepEqual(creates.at(-1), ["Button title", true]);
      assert.equal(title, "");
    });
    await t.test("pending submission locks both buttons and prevents double submission/cancel", async () => {
      pending = true;
      await fill("Pending");
      const before = creates.length;
      await event(buttons()[0], "click");
      assert.equal(area().readOnly, true);
      assert.equal(area().getAttribute("aria-busy"), "true");
      assert.ok(buttons().every((button) => button.disabled));
      await event(area(), "keydown", { key: "Enter" });
      await event(area(), "keydown", { key: "Escape" });
      await React.act(async () => document.getElementById("outside").focus());
      assert.equal(cancels, 0);
      assert.equal(creates.length, before + 1);
      await React.act(async () => resolveCreate(true));
      assert.equal(title, "");
      pending = false;
    });
    await t.test("false and rejected creation retain text for retry", async () => {
      for (const failure of [false, new Error("network")]) {
        result = failure;
        await fill("Retry title");
        await event(buttons()[0], "click");
        assert.equal(title, "Retry title");
        assert.equal(area().readOnly, false);
        assert.equal(toasts.at(-1), "Could not create the task, try again");
      }
      result = true;
    });
    await t.test("keyboard focus can move to actions without cancellation, then leaving cancels", async () => {
      await React.act(async () => area().focus());
      await React.act(async () => buttons()[0].focus());
      await React.act(async () => buttons()[1].focus());
      assert.equal(cancels, 0);
      await React.act(async () => document.getElementById("outside").focus());
      assert.equal(cancels, 1);
      assert.equal(title, "");
      assert.equal(area(), null);
    });
    await t.test("Escape and X discard text without submission or global Escape propagation", async () => {
      let globalEscapes = 0;
      const globalEscape = (e) => { if (e.key === "Escape") globalEscapes++; };
      document.addEventListener("keydown", globalEscape);
      const before = creates.length;
      for (const action of ["Escape", "X", "action-row Escape"]) {
        await mount();
        await fill("Discard");
        if (action === "X") await event(buttons()[1], "click");
        else await event(action === "Escape" ? area() : buttons()[1], "keydown", { key: "Escape" });
        assert.equal(area(), null);
        assert.equal(title, "");
        await mount();
        assert.equal(area().value, "");
      }
      assert.equal(creates.length, before);
      assert.equal(globalEscapes, 0);
      document.removeEventListener("keydown", globalEscape);
      assert.ok(disconnected > 0);
    });
    await t.test("flag off keeps the original input, styles, Enter and blur behavior", async () => {
      enabled = false;
      await mount();
      const input = document.querySelector("#newTask input");
      assert.ok(input);
      assert.equal(area(), null);
      assert.equal(buttons().length, 0);
      assert.equal(input.className, "sm:text-content xs:text-emphasis text-white-black font-bold");
      assert.equal(inputRef.current, input);
      await React.act(async () => setTitle("Old input"));
      await event(input, "keydown", { key: "Enter" });
      assert.deepEqual(creates.at(-1), ["Old input", true]);
      const before = cancels;
      await React.act(async () => input.focus());
      await React.act(async () => document.getElementById("outside").focus());
      assert.equal(cancels, before + 1);
    });
  } finally {
    await React.act(async () => reactRoot.unmount());
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    dom.window.close();
  }
});
