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

async function renderHarness(threshold = 10, shouldHandleEvent) {
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
        shouldHandleEvent,
      },
    );
    return React.createElement("button", bind,
      React.createElement("span", { "data-target": "control" }, "control"),
      React.createElement("span", { "data-target": "text" }, "comment"));
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

for (const filtered of [true, false]) {
  for (const delay of [0, 15]) {
    test(`${filtered ? "filtered" : "legacy"} native fallback ${filtered ? "remembers" : "does not filter"} a rejected opening control click (delay=${delay})`, async (t) => {
      const harness = await renderHarness(10, filtered
        ? (event) => event.target.dataset.target !== "control"
        : undefined);
      t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
      try {
        const control = harness.button.querySelector("[data-target='control']");
        const text = harness.button.querySelector("[data-target='text']");
        await React.act(async () => {
          control.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true, detail: 1 }));
          t.mock.timers.tick(delay);
          text.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true, detail: 2 }));
          text.dispatchEvent(new harness.dom.window.MouseEvent("dblclick", { bubbles: true, detail: 2 }));
        });
        assert.deepEqual(harness.counts(), { doubleTaps: filtered ? 0 : 1, singleTaps: !filtered && delay ? 1 : 0 });

        if (filtered) {
          await React.act(async () => {
            text.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true, detail: 1 }));
            t.mock.timers.tick(15);
            text.dispatchEvent(new harness.dom.window.MouseEvent("click", { bubbles: true, detail: 2 }));
            text.dispatchEvent(new harness.dom.window.MouseEvent("dblclick", { bubbles: true, detail: 2 }));
          });
          assert.deepEqual(harness.counts(), { doubleTaps: 1, singleTaps: 1 }, "a later accepted opening click must restore the native fallback");
        }
      } finally {
        await harness.cleanup();
      }
    });
  }
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

test("the native fallback does not double-fire a fast custom double tap", async (t) => {
  const harness = await renderHarness();
  // Keep simulated fast taps within the threshold even on a busy test runner.
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
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
