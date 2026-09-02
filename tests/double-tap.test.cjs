const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(__dirname, "../src") },
});
const { useDoubleTap } = jiti(
  path.join(__dirname, "../src/hooks/MultiPages/useDoubleTap.ts"),
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function renderHarness(threshold = 10) {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  };
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  let doubleTaps = 0;
  let singleTaps = 0;
  function Harness() {
    const bind = useDoubleTap(
      () => {
        doubleTaps += 1;
      },
      threshold,
      {
        onSingleTap: () => {
          singleTaps += 1;
        },
      },
    );
    return React.createElement("button", bind, "comment");
  }

  const root = createRoot(document.getElementById("root"));
  await React.act(async () => root.render(React.createElement(Harness)));
  const button = document.querySelector("button");

  return {
    button,
    dom,
    counts: () => ({ doubleTaps, singleTaps }),
    cleanup: async () => {
      await React.act(async () => root.unmount());
      dom.window.close();
      global.window = previous.window;
      global.document = previous.document;
      global.navigator = previous.navigator;
      global.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

test("a native double-click still edits when two taps exceed the custom timer", async () => {
  const harness = await renderHarness();
  try {
    await React.act(async () => {
      harness.button.click();
      await wait(15);
      harness.button.click();
      harness.button.dispatchEvent(
        new harness.dom.window.MouseEvent("dblclick", { bubbles: true }),
      );
    });
    assert.deepEqual(harness.counts(), { doubleTaps: 1, singleTaps: 1 });
  } finally {
    await harness.cleanup();
  }
});

test("the native fallback does not double-fire a fast custom double tap", async () => {
  const harness = await renderHarness();
  try {
    await React.act(async () => {
      harness.button.click();
      harness.button.click();
      harness.button.dispatchEvent(
        new harness.dom.window.MouseEvent("dblclick", { bubbles: true }),
      );
    });
    assert.deepEqual(harness.counts(), { doubleTaps: 1, singleTaps: 0 });
  } finally {
    await harness.cleanup();
  }
});
