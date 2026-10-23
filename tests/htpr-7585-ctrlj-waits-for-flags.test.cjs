const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const fixFlag = "htpr-7585-ctrlj-waits-for-flags";
const composeFlag = "htpr-6929-compose-task-writer";

function load(relativePath, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((specifier) => {
    if (Object.hasOwn(mocks, specifier)) return { __esModule: true, ...mocks[specifier] };
    assert.equal(specifier, "react", `unmocked dependency: ${specifier}`);
    return React;
  }, loaded, loaded.exports);
  return loaded.exports;
}

async function withBoard({ apple = false, flags = {}, commandCenter = false }, check) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai/project/15" });
  const names = ["window", "document", "navigator", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) {
    Object.defineProperty(global, name, { configurable: true, value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name] });
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const createCalls = [];
  const paletteCalls = [];
  const showCommandsAtom = {};
  const mocks = {
    "@/hooks/useFlag": {
      useFlag: (key) => flags[key] === true,
      useFlagLoaded: (key) => Object.hasOwn(flags, key),
      useFlagReady: () => true,
    },
    "@/lib/flags/keys": { HTPR_6929_COMPOSE_TASK_WRITER_FLAG: composeFlag, HTPR_7585_CTRLJ_WAITS_FOR_FLAGS_FLAG: fixFlag },
    "@/lib/state": {
      useRecoilState: () => React.useState(null),
      useSetRecoilState: (atom) => atom === showCommandsAtom ? (value) => paletteCalls.push(value) : () => {},
    },
    "@/store": { activeItemAtom: {}, currentProjectAtom: {}, showCommandsAtom },
    "jotai": { useStore: () => ({ get: () => null }) },
    "next/navigation": { useRouter: () => ({ refresh: () => assert.fail("must not refresh") }) },
    "../MultiPages/useAddDeleteTaskInBoards": { default: () => ({ createItem: () => assert.fail("must not submit") }) },
    "../RecoilRoot/useHypertasksRecoilStates": { default: () => ({ toggleCreateTaskGlobally: (...args) => createCalls.push(args) }) },
    "@/lib/constants": { default: {} },
    "@/lib/contexts/deviceContext": { useDeviceContext: () => apple },
    "@/utils/helperFunctions/helperFunctions": { returnIfModalOrInputActive: () => document.activeElement?.tagName === "INPUT" },
    "@/lib/constants/keyboard-handler": { KeyCodes: { J: 74, C: 67 } },
    "../MultiPages/Route/useHypertasksNavigate": { default: () => ({ navigate: () => {} }) },
    "axios": { default: { post: () => assert.fail("must not write") } },
    "@/models/enums": { CommandMode: { Command: 0 } },
  };
  const useSections = load("src/hooks/Homepage/useSections.ts", mocks).default;
  const { useCommandCenterShortcut } = load("src/hooks/General/useCommandCenterShortcut.ts", {
    ...mocks,
    "@/lib/constants/commandCenterShortcut": load("src/lib/constants/commandCenterShortcut.ts", {}),
  });
  const items = [];
  const toggleCommands = () => assert.fail("Ctrl+J must not toggle search");
  function Harness() {
    useCommandCenterShortcut(commandCenter ? 985 : null, apple, "/project/15", false, false, toggleCommands);
    const section = useSections({ items, active: true, index: 0, title: "Bugs", sectionId: 1, projectId: 15 });
    return React.createElement("div", { id: "section", ref: section.sectionRef, tabIndex: 0 });
  }
  const reactRoot = require("react-dom/client").createRoot(document.getElementById("root"));
  const render = () => React.act(async () => reactRoot.render(React.createElement(Harness)));
  try {
    await render();
    const press = async (extra = {}) => {
      const event = new dom.window.KeyboardEvent("keydown", {
        key: "j", code: "KeyJ", keyCode: 74, ctrlKey: !apple, metaKey: apple, bubbles: true, cancelable: true, ...extra,
      });
      const section = document.getElementById("section");
      await React.act(async () => section.dispatchEvent(event));
      await React.act(async () => section.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: event.key, bubbles: true })));
      return event;
    };
    await check({ createCalls, paletteCalls, press, updateFlags: async (values) => { Object.assign(flags, values); await render(); } });
  } finally {
    await React.act(async () => reactRoot.unmount());
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    dom.window.close();
  }
}

const legacyArgs = [
  { sectionId: 1, sectionTitle: "Bugs", position: "top" },
  { defaultEditMode: "Description-ai", defaultFocus: "Description" },
];

for (const apple of [false, true]) {
  const chord = apple ? "Cmd+J" : "Ctrl+J";

  test(`${chord} ignores unknown compose, including a pending fix flag, then allows known Off without remounting`, async () => {
    for (const initial of [{}, { [fixFlag]: true }]) {
      await withBoard({ apple, flags: { ...initial } }, async ({ press, createCalls, paletteCalls, updateFlags }) => {
        for (let attempt = 0; attempt < 2; attempt++) {
          assert.equal((await press()).defaultPrevented, true, "unknown flags must not open browser downloads, even when ready reports fallback");
          assert.deepEqual(createCalls, []);
          assert.deepEqual(paletteCalls, []);
        }
        await updateFlags({ [fixFlag]: true, [composeFlag]: false });
        assert.equal((await press()).defaultPrevented, true);
        assert.deepEqual(createCalls, [legacyArgs], "known Off still opens the existing AI editor with the original section and focus");
      });
    }
  });

  test(`${chord} leaves known On to the real capture hook and never opens the legacy page`, async () => {
    await withBoard({ apple, flags: { [fixFlag]: true, [composeFlag]: true } }, async ({ press, createCalls }) => {
      assert.equal((await press()).defaultPrevented, true);
      assert.deepEqual(createCalls, [], "the legacy handler must also be safe before the capture hook runs");
    });
    await withBoard({ apple, commandCenter: true }, async ({ press, createCalls, paletteCalls, updateFlags }) => {
      await press();
      assert.deepEqual(createCalls, []);
      await updateFlags({ [fixFlag]: true, [composeFlag]: true });
      assert.equal((await press()).defaultPrevented, true);
      assert.deepEqual(createCalls, []);
      assert.deepEqual(paletteCalls, [{ show: true, mode: 0, paletteTab: "compose" }]);
    });
  });

  test(`${chord} with fix Off preserves legacy behavior for unknown, Off, and On compose values`, async () => {
    for (const compose of [{}, { [composeFlag]: false }, { [composeFlag]: true }]) {
      await withBoard({ apple, flags: { [fixFlag]: false, ...compose } }, async ({ press, createCalls }) => {
        assert.equal((await press()).defaultPrevented, true);
        assert.deepEqual(createCalls, [legacyArgs]);
      });
    }
    await withBoard({ apple }, async ({ press, createCalls, updateFlags }) => {
      await press();
      assert.deepEqual(createCalls, []);
      await updateFlags({ [fixFlag]: false });
      await press();
      assert.deepEqual(createCalls, [legacyArgs], "resolving fix Off immediately restores today's fallback");
    });
  });

  test(`${chord} pending guard leaves plain C and non-command J behavior unchanged`, async () => {
    await withBoard({ apple }, async ({ press, createCalls }) => {
      assert.equal((await press({ ctrlKey: false, metaKey: false })).defaultPrevented, false);
      assert.deepEqual(createCalls, []);
      assert.equal((await press({ key: "c", code: "KeyC", keyCode: 67, ctrlKey: false, metaKey: false })).defaultPrevented, true);
      assert.deepEqual(createCalls, [[legacyArgs[0], undefined]]);
    });
  });
}
