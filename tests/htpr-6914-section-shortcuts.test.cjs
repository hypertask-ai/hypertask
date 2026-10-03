const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const nFlag = "htpr-6902-n-quick-add";
const quickFlag = "htpr-6175-quick-entry-cards";
const shiftCFlag = "htpr-6914-shift-c-quick-add";
const sectionPath = path.resolve(__dirname, "../src/hooks/Homepage/useSections.ts");

for (const toggledFlag of [nFlag, quickFlag, shiftCFlag]) {
  test(`active column shortcuts survive ${toggledFlag} toggles without changing the active column`, async () => {
    const dom = new JSDOM("<!doctype html><div id='root'></div>");
    const names = ["window", "document", "navigator", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
    const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
    for (const name of names) Object.defineProperty(global, name, {
      configurable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name],
    });
    const { createRoot } = require("react-dom/client");
    const root = createRoot(document.getElementById("root"));
    const flags = { [nFlag]: true, [quickFlag]: true, [shiftCFlag]: true, [toggledFlag]: false };
    const calls = [];
    const mocks = {
      react: React,
      axios: {},
      "@/store": {},
      "@/lib/state": { useRecoilState: () => React.useState({ id: 15 }), useSetRecoilState: () => () => {} },
      jotai: { useStore: () => ({ get: () => null }) },
      "next/navigation": { useRouter: () => ({ refresh: () => {} }) },
      "../MultiPages/useAddDeleteTaskInBoards": { default: () => ({ createItem: async () => true }) },
      "@/models/CreateTaskModalModels/model": {},
      "../RecoilRoot/useHypertasksRecoilStates": { default: () => ({ toggleCreateTaskGlobally: (...args) => calls.push(args) }) },
      "@/lib/constants": { default: {} },
      "@/lib/contexts/deviceContext": { useDeviceContext: () => false },
      "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => false },
      "@/lib/constants/keyboard-handler": { KeyCodes: { C: 67 } },
      "../MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: () => {} }) },
      "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
      "@/hooks/useFlag": { useFlag: (key) => flags[key] === true },
      "@/lib/flags/keys": { HTPR_6902_N_QUICK_ADD_FLAG: nFlag, HTPR_6914_SHIFT_C_QUICK_ADD_FLAG: shiftCFlag },
    };
    const source = fs.readFileSync(process.env.HTPR_6914_SECTION_SOURCE || sectionPath, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const loaded = { exports: {} };
    new Function("require", "module", "exports", compiled)(
      (name) => {
        assert.ok(name in mocks, `unexpected dependency: ${name}`);
        return { __esModule: true, ...mocks[name] };
      }, loaded, loaded.exports,
    );
    const useSections = loaded.exports.default;
    const items = [];
    const Column = ({ index }) => {
      const state = useSections({ items, active: index === 0, index, title: `Column ${index}`, sectionId: 10 + index, projectId: 15 });
      return React.createElement("div", { ref: state.sectionRef, "data-column": index, tabIndex: 0 });
    };
    const render = () => React.act(async () => root.render(React.createElement(React.StrictMode, null,
      React.createElement(Column, { index: 0 }), React.createElement(Column, { index: 1 }),
    )));
    const press = (shiftKey = false, ctrlKey = false) => React.act(async () => {
      document.querySelector('[data-column="0"]').dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: shiftKey ? "C" : "c", keyCode: 67, shiftKey, ctrlKey, bubbles: true, cancelable: true,
      }));
    });
    try {
      await render();
      const activeColumn = document.querySelector('[data-column="0"]');
      for (const enabled of [false, true, false, true]) {
        flags[toggledFlag] = enabled;
        await render();
        assert.equal(document.querySelector('[data-column="0"]'), activeColumn, "the active column must not remount");
        calls.length = 0;
        await press();
        assert.equal(calls.length, 1, "plain C must still open the editor");
        assert.equal(calls[0][0].sectionId, 10, "only the active column handles the shortcut");
        calls.length = 0;
        await press(true);
        assert.equal(calls.length, enabled ? 0 : 1, "Shift+C must use the latest flags, not a stale handler");
        if (!enabled) assert.equal(calls[0][0].position, "bottom");
        calls.length = 0;
        await press(true, true);
        assert.equal(calls.length, 1, "Ctrl+Shift+C remains available after each toggle");
        assert.equal(calls[0][0].position, "top");
      }
      await React.act(async () => root.unmount());
      calls.length = 0;
      document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "c", keyCode: 67, bubbles: true }));
      assert.equal(calls.length, 0, "unmount removes the delegated handler");
    } finally {
      await React.act(async () => root.unmount());
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(global, name, descriptor);
        else delete global[name];
      }
    }
  });
}
