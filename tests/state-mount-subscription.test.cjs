const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

require("tsx/cjs");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createStore, useStore } = require("jotai");
const { RESET } = require("jotai/utils");
const {
  atom,
  selectorFamily,
  StateRoot,
  useRecoilState,
  useRecoilValue,
  useSetRecoilState,
} = require(path.join(__dirname, "../src/lib/state.tsx"));

for (const hook of [useRecoilValue, useRecoilState]) {
  for (const [effectName, effect] of [
    ["useEffect", React.useEffect],
    ["useLayoutEffect", React.useLayoutEffect],
  ]) {
    test(`${hook.name} observes a child's ${effectName} write on first mount`, async () => {
      const dom = new JSDOM("<div id='root'></div>", { url: "https://example.test" });
      const previous = {
        window: global.window,
        document: global.document,
        IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
      };
      global.window = dom.window;
      global.document = dom.window.document;
      global.IS_REACT_ACT_ENVIRONMENT = true;
      const root = createRoot(document.getElementById("root"));
      const currentProject = atom({ key: "mount-project", default: "old board" });
      let store;
      let update;

      function Board() {
        const setProject = useSetRecoilState(currentProject);
        store = useStore();
        update = setProject;
        effect(() => setProject("incoming board"), [setProject]);
        return null;
      }

      function Shell() {
        const result = hook(currentProject);
        const value = hook === useRecoilState ? result[0] : result;
        return React.createElement(
          React.Fragment,
          null,
          React.createElement("output", null, value),
          React.createElement(Board),
        );
      }

      try {
        await React.act(async () => {
          root.render(React.createElement(StateRoot, null, React.createElement(Shell)));
        });
        assert.equal(store.get(currentProject), "incoming board");
        assert.equal(document.querySelector("output").textContent, "incoming board");
        await React.act(async () => update((previous) => `${previous} updated`));
        assert.equal(document.querySelector("output").textContent, "incoming board updated");
        await React.act(async () => store.set(currentProject, RESET));
        assert.equal(document.querySelector("output").textContent, "old board");
      } finally {
        await React.act(async () => root.unmount());
        dom.window.close();
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete global[key];
          else global[key] = value;
        }
      }
    });
  }
}

test("state atoms retain store isolation, subscriptions, selector caching and reset", () => {
  const count = atom({ key: "store-count", default: 1 });
  const multiplied = selectorFamily({
    key: "multiplied",
    get: (factor) => ({ get }) => get(count) * factor,
  });
  const first = createStore();
  const second = createStore();
  const notifications = [];
  assert.equal(multiplied(3), multiplied(3));
  const unsubscribe = first.sub(multiplied(3), () => notifications.push(first.get(multiplied(3))));
  first.set(count, (previous) => previous + 1);
  assert.equal(first.get(multiplied(3)), 6);
  assert.equal(second.get(count), 1);
  first.set(count, RESET);
  assert.equal(first.get(count), 1);
  assert.deepEqual(notifications, [6, 3]);
  unsubscribe();
  first.set(count, 9);
  assert.deepEqual(notifications, [6, 3]);
});
