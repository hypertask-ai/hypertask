const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { createRefactoredModuleRequire } = require("./refactored-module-require.cjs");

const load = createRefactoredModuleRequire(path.join(__dirname, ".."), {});
const { BoardStartupProvider, useBoardStartup } = load("./src/lib/contexts/boardStartupContext.tsx");

test("unchanged startup inputs do not re-render consumers, but each changed input does", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }

  let renders = 0;
  let startup;
  function Consumer() {
    renders += 1;
    startup = useBoardStartup();
    return React.createElement("span", null, String(startup.secondaryStartupEnabled));
  }
  const children = React.createElement(Consumer);
  let parentRenders = 0;
  function Parent({ releaseSecondaryStartup, markBoardUsable, secondaryStartupEnabled }) {
    parentRenders += 1;
    return React.createElement(BoardStartupProvider, {
      value: { releaseSecondaryStartup, markBoardUsable, secondaryStartupEnabled },
    }, children);
  }
  let releases = 0;
  let usable = 0;
  const props = {
    releaseSecondaryStartup: () => { releases += 1; },
    markBoardUsable: () => { usable += 1; },
    secondaryStartupEnabled: false,
  };
  const root = createRoot(document.getElementById("root"));
  const render = () => root.render(React.createElement(Parent, { ...props }));
  try {
    await React.act(async () => render());
    assert.equal(renders, 1);
    const initialValue = startup;
    await React.act(async () => render());
    assert.equal(parentRenders, 2);
    assert.equal(renders, 1, "unchanged startup inputs must not re-render the consumer");
    assert.equal(startup, initialValue);

    props.secondaryStartupEnabled = true;
    await React.act(async () => render());
    assert.equal(renders, 2);
    assert.equal(document.querySelector("span").textContent, "true");
    assert.notEqual(startup, initialValue);
    startup.releaseSecondaryStartup();
    startup.markBoardUsable();
    assert.equal(releases, 1);
    assert.equal(usable, 1);

    props.releaseSecondaryStartup = () => { releases += 10; };
    await React.act(async () => render());
    assert.equal(renders, 3);
    assert.equal(startup.releaseSecondaryStartup, props.releaseSecondaryStartup);
    startup.releaseSecondaryStartup();
    assert.equal(releases, 11);

    props.markBoardUsable = () => { usable += 10; };
    await React.act(async () => render());
    assert.equal(renders, 4);
    assert.equal(startup.markBoardUsable, props.markBoardUsable);
    startup.markBoardUsable();
    assert.equal(usable, 11);

    await React.act(async () => render());
    assert.equal(parentRenders, 6);
    assert.equal(renders, 4);
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    dom.window.close();
  }
});
