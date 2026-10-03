const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

for (const growEnabled of [false, true]) test(`quick-entry Escape cancels only the card, discards its text, and never submits (grow ${growEnabled ? "on" : "off"})`, async (t) => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", {
    url: "https://app.hypertask.ai/project?id=15",
  });
  const globals = ["window", "document", "navigator", "HTMLElement", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = globals.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of globals) {
    Object.defineProperty(global, name, {
      configurable: true,
      value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
    });
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const activeItems = [];
  let submitted = 0;
  let globalEscapes = 0;
  let section;
  const mocks = {
    "@/lib/state": {
      useRecoilState: () => React.useState(null),
      useSetRecoilState: () => (value) => activeItems.push(value),
    },
    "@/store": { activeItemAtom: {}, currentProjectAtom: {} },
    "jotai": { useStore: () => ({ get: () => null }) },
    "next/navigation": { useRouter: () => ({ refresh: () => {} }) },
    "../MultiPages/useAddDeleteTaskInBoards": { default: () => ({ createItem: async () => { submitted++; return true; } }) },
    "../RecoilRoot/useHypertasksRecoilStates": { default: () => ({ toggleCreateTaskGlobally: () => assert.fail("full editor must not open") }) },
    "@/models/CreateTaskModalModels/model": require("jiti").createJiti(__filename, { alias: { "@": path.join(root, "src") } })(path.join(root, "src/models/CreateTaskModalModels/model.ts")),
    "@/lib/constants": { default: {} },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => document.activeElement?.tagName === "INPUT" },
    "@/lib/constants/keyboard-handler": { KeyCodes: {} },
    "../MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: () => {} }) },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    "@/hooks/useFlag": { useFlag: (key) => key === "htpr-6175-quick-entry-cards" || (growEnabled && key === "htpr-6873-quick-entry-grow") },
    "@/lib/flags/keys": { HTPR_6873_QUICK_ENTRY_GROW_FLAG: "htpr-6873-quick-entry-grow" },
    "@/lib/configs/general.config": { MOBILE_TARGET: "min-h-[44px] min-w-[44px] shrink-0 flex items-center justify-center" },
    "react-hot-toast": { default: () => {} },
    "axios": { default: { post: () => assert.fail("cancellation must not write") } },
  };
  function load(relativePath) {
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const loaded = { exports: {} };
    new Function("require", "module", "exports", compiled)(
      (specifier) => mocks[specifier] ? { __esModule: true, ...mocks[specifier] } : require(specifier),
      loaded, loaded.exports,
    );
    return loaded.exports.default;
  }
  const useSections = load("src/hooks/Homepage/useSections.ts");
  const NewTask = load("src/components/Common/newTask.tsx");
  const populatedItems = [{ id: 101, ranking: "a" }, { id: 102, ranking: "b" }];
  const Harness = ({ items = populatedItems }) => {
    section = useSections({ items, active: true, index: 0, title: "Bugs", sectionId: 1, projectId: 15 });
    return React.createElement("div", { ref: section.sectionRef, tabIndex: -1 },
      React.createElement("button", { onClick: () => section.createTaskAt("top", undefined, undefined, true) }, "Add"),
      section.showAddItem && React.createElement(NewTask, {
        title: section.newTaskDraftTitle,
        onTitleChange: section.setNewTaskDraftTitle,
        inputRef: section.position === "top" ? section.topInputRef : section.bottomInputRef,
        invokeCreateItem: section.invokeCreateItem,
        onCancelCreate: section.onCancelCreate,
      }),
      ...items.map((item) => React.createElement("div", { key: item.id, id: `task-${item.id}`, tabIndex: 0 }, "Existing card")),
    );
  };
  // This is the external boundary: global handlers see the refocused card,
  // not the input, unless the local cancellation consumes its own Escape.
  const globalKeydown = (event) => { if (event.key === "Escape") globalEscapes++; };
  document.addEventListener("keydown", globalKeydown);
  const { createRoot } = require("react-dom/client");
  const reactRoot = createRoot(document.getElementById("root"));
  const press = async (target) => React.act(async () => target.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true, cancelable: true }),
  ));
  try {
    await React.act(async () => reactRoot.render(React.createElement(Harness)));
    for (const position of ["top", "bottom"]) {
      await t.test(`${position}: cancellation keeps the active task and DOM focus in agreement`, async () => {
        await React.act(async () => section.createTaskAt(position, undefined, undefined, true));
        await React.act(async () => section.onCancelCreate());
        const expectedId = position === "top" ? 101 : 102;
        assert.equal(activeItems.at(-1), expectedId, "active task must match the cancellation focus target");
        assert.equal(document.activeElement.id, `task-${expectedId}`);
      });
      for (const text of ["", "Discard this unsent card"]) {
        await t.test(`${position}: ${text ? "typed" : "empty"} Escape and Escape twice`, async () => {
          await React.act(async () => section.createTaskAt(position, undefined, undefined, true));
          await React.act(async () => section.setNewTaskDraftTitle(text));
          const input = document.querySelector("#newTask input, #newTask textarea");
          assert.equal(input.value, text);
          const before = globalEscapes;
          await press(input);
          assert.equal(globalEscapes, before, "local Escape must not reach global panel/reset handlers");
          assert.equal(document.querySelector("#newTask"), null);
          assert.equal(section.newTaskDraftTitle, "", "cancel discards the unsent title");
          assert.equal(section.position, null);
          assert.equal(submitted, 0);
          await press(document.activeElement);
          assert.equal(globalEscapes, before + 1, "a subsequent board Escape remains available globally");
          await React.act(async () => section.createTaskAt(position, undefined, undefined, true));
          assert.equal(document.querySelector("#newTask input, #newTask textarea").value, "", "reopening must not restore a cancelled draft");
          await press(document.querySelector("#newTask input, #newTask textarea"));
        });
      }
    }
    await t.test("empty column cancellation clears the active task and focuses its column", async () => {
      await React.act(async () => reactRoot.render(React.createElement(Harness, { items: [] })));
      for (const position of ["top", "bottom"]) {
        await React.act(async () => section.createTaskAt(position, undefined, undefined, true));
        await press(document.querySelector("#newTask input, #newTask textarea"));
        assert.equal(activeItems.at(-1), null);
        assert.equal(document.activeElement, section.sectionRef.current);
        assert.equal(section.showAddItem, false);
      }
      assert.equal(submitted, 0);
    });
  } finally {
    document.removeEventListener("keydown", globalKeydown);
    await React.act(async () => reactRoot.unmount());
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    dom.window.close();
  }
});
