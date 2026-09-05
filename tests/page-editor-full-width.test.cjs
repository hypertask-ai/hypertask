const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { createJiti } = require("jiti");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/app/page/[publicId]/PageEditor.tsx"),
  "utf8",
);

// HTPR-5484: Pages are where agents render designs, so the editor has to give
// them the whole width after the app rail. A re-introduced max-width or card
// surface silently takes that space back.
test("the editor is not constrained to a centred document column", () => {
  assert.doesNotMatch(source, /max-w-\[900px\]/);
  assert.doesNotMatch(source, /mx-auto w-full/);
});

test("the editor keeps no card chrome", () => {
  assert.doesNotMatch(source, /bg-taskDetal-container/);
  assert.doesNotMatch(source, /rounded-xl/);
});

test("the slim utility row survives", () => {
  assert.match(source, /Back to task/);
  assert.match(source, /Version \{version\}/);
});

test("Page keyboard return stays global when focus is outside the editor", () => {
  assert.match(
    source,
    /document\.addEventListener\("keydown", handleKeyDown\)/,
  );
  assert.match(
    source,
    /shouldReturnFromPageOnEscape\(event, showCommands\.show\)/,
  );
  assert.match(
    source,
    /document\.removeEventListener\("keydown", handleKeyDown\)/,
  );
  assert.match(source, /flushTitleSave\(\);[\s\S]*flushContentSave\(\);/);
  assert.match(
    source,
    /Promise\.all\(\[titleSaveChainRef\.current, contentSaveChainRef\.current\]\)/,
  );
  assert.match(source, /showCommands\.show && <HypertasksCommands \/>/);
});

test("the mobile page canvas uses the full viewport at every zoom level", () => {
  assert.match(source, /useContentZoom\(contentRef, \{ min: 0\.5 \}\)/);
  assert.match(source, /style=\{\{ zoom, width: `\$\{100 \/ zoom\}%` \}\}/);
  assert.doesNotMatch(source, /isMobile \? "[^"]*px-3/);
});

test("page pinch zoom reaches a half-scale desktop-like canvas", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://app.hypertask.ai/page/example",
  });
  const globalNames = [
    "window",
    "document",
    "HTMLElement",
    "IS_REACT_ACT_ENVIRONMENT",
  ];
  const previousGlobals = new Map(
    globalNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(global, name),
    ]),
  );
  let reactRoot;

  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.IS_REACT_ACT_ENVIRONMENT = true;

    const jiti = createJiti(__filename);
    const { useContentZoom } = jiti(
      path.resolve(__dirname, "../src/hooks/General/useContentZoom.ts"),
    );
    const Harness = () => {
      const targetRef = React.useRef(null);
      const { zoom } = useContentZoom(targetRef, {
        min: 0.5,
        storageKey: "test:page-zoom",
      });
      return React.createElement("div", {
        ref: targetRef,
        "data-zoom": zoom,
        style: { zoom },
      });
    };

    const container = document.getElementById("root");
    reactRoot = createRoot(container);
    await React.act(async () => {
      reactRoot.render(React.createElement(Harness));
    });

    const target = container.firstElementChild;
    const touchEvent = (type, touches) => {
      const event = new dom.window.Event(type, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "touches", { value: touches });
      return event;
    };
    const startTouches = [
      { clientX: 0, clientY: 0 },
      { clientX: 200, clientY: 0 },
    ];
    const zoomedOutTouches = [
      { clientX: 0, clientY: 0 },
      { clientX: 50, clientY: 0 },
    ];

    await React.act(async () => {
      target.dispatchEvent(touchEvent("touchstart", startTouches));
      target.dispatchEvent(touchEvent("touchmove", zoomedOutTouches));
    });

    assert.equal(target.dataset.zoom, "0.5");
    assert.equal(target.style.zoom, "0.5");
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor === undefined) delete global[name];
      else Object.defineProperty(global, name, descriptor);
    }
  }
});
