const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

function scrollable(document, initial = 0) {
  const element = document.createElement("div");
  let scrollTop = initial;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value) => {
      scrollTop = Number(value);
    },
  });
  return element;
}

function buttonFor(controls) {
  return loadModule("src/components/PageComponents/TaskDetail/CommentAndDescription/JumpToTopButton.tsx", {
    "@/hooks/useFlag": {
      useFlag: (key) => key === "htpr-8998-jump-to-top" && controls.flagOn,
    },
    "@/lib/contexts/TaskDetail/TaskProvider": {
      useTaskContext: () => ({
        focusOn: (id, select) => controls.focus.push([id, select]),
        scrollVirtualize: (target) => controls.scrolled.push(target),
        virtualizer: controls.virtualizer,
      }),
    },
    "@/lib/constants/TaskDetail": { descriptionContainerId: "description-container" },
    "lucide-react": { ArrowUp: () => React.createElement("svg", { "data-icon": "arrow-up" }) },
    "@/components/Common/Tooltip": {
      default: ({ text, keyCombination }) => React.createElement("span", {
        "data-tooltip": text,
        "data-keys": keyCombination.join(" "),
      }),
    },
  }).default;
}

function controlsFor() {
  const controls = {
    flagOn: false,
    focus: [],
    scrolled: [],
    scrollElement: null,
    virtualizer: null,
  };
  controls.virtualizer = {
    get scrollElement() {
      return controls.scrollElement;
    },
  };
  return controls;
}

async function withPage(controls, run) {
  const Button = buttonFor(controls);
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-15/8998" });
  const keys = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const queued = new Map();
  let nextFrame = 1;
  let windowScrollY = 0;
  const windowScrollListeners = new Set();
  const { window } = dom;
  const originalAdd = window.addEventListener.bind(window);
  const originalRemove = window.removeEventListener.bind(window);
  window.addEventListener = (type, listener, options) => {
    if (type === "scroll") windowScrollListeners.add(listener);
    return originalAdd(type, listener, options);
  };
  window.removeEventListener = (type, listener, options) => {
    if (type === "scroll") windowScrollListeners.delete(listener);
    return originalRemove(type, listener, options);
  };
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => windowScrollY });
  window.requestAnimationFrame = (callback) => {
    const id = nextFrame;
    nextFrame += 1;
    queued.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queued.delete(id);
  };
  global.window = window;
  global.document = window.document;
  global.HTMLElement = window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const reactRoot = createRoot(window.document.getElementById("root"));
  const paint = () => React.act(async () => {
    reactRoot.render(React.createElement(Button));
  });
  const button = () => window.document.querySelector("[data-testid='jump-to-top']");
  const flushFrames = async (times = 1) => {
    for (let step = 0; step < times; step += 1) {
      const batch = [...queued.values()];
      queued.clear();
      if (!batch.length) return;
      await React.act(async () => {
        batch.forEach((callback) => callback(0));
      });
    }
  };
  try {
    await run({
      window,
      paint,
      button,
      flushFrames,
      windowScrollListeners,
      setWindowScrollY: (value) => {
        windowScrollY = value;
      },
    });
  } finally {
    await React.act(async () => reactRoot.unmount());
    window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

test("htpr-8998 jump to top is a desktop feature held at owner and qa", () => {
  const flag = loadModule("src/lib/flags/definitions/htpr-8998-jump-to-top.ts");
  assert.equal(flag.HTPR_8998_JUMP_TO_TOP_FLAG, "htpr-8998-jump-to-top");
  assert.equal(flag.default.key, "htpr-8998-jump-to-top");
  assert.equal(flag.default.kind, "feature");
  assert.equal(flag.default.defaultMode, "OWNER_AND_QA");
  assert.equal(flag.default.releaseRisk.risk, "new");
});

test("jump to top button", async (t) => {
  await t.test("stays hidden until the flag is on and the ticket is scrolled", async () => {
    const controls = controlsFor();
    await withPage(controls, async ({ window, paint, button }) => {
      const element = scrollable(window.document, 800);
      controls.scrollElement = element;
      await paint();
      assert.equal(button() === null, true, "flag off hides the button even after a long scroll");

      controls.flagOn = true;
      element.scrollTop = 200;
      await paint();
      assert.equal(button() === null, true, "the button waits until the ticket moves past 200px");

      element.scrollTop = 201;
      await React.act(async () => {
        element.dispatchEvent(new window.Event("scroll"));
      });
      const shown = button();
      assert.ok(shown, "a scrolled ticket shows the button when the flag is on");
      assert.match(shown.className, /\bh-8\b/);
      assert.match(shown.className, /\bw-8\b/);
      assert.match(shown.className, /rounded-\[4px\]/);
      assert.equal(shown.getAttribute("aria-label"), "Jump to top");
      assert.equal(shown.querySelector("[data-tooltip]")?.getAttribute("data-tooltip"), "Jump to top");
      assert.equal(shown.querySelector("[data-tooltip]")?.getAttribute("data-keys"), "G G");
      assert.ok(shown.querySelector("[data-icon='arrow-up']"));

      await React.act(async () => {
        shown.click();
      });
      assert.deepEqual(controls.focus, [["description-container", false]]);
      assert.deepEqual(controls.scrolled, ["description"]);
    });
  });

  await t.test("tracks the window when the ticket scroller is the window", async () => {
    const controls = controlsFor();
    controls.flagOn = true;
    await withPage(controls, async ({ window, paint, button, setWindowScrollY }) => {
      controls.scrollElement = window;
      setWindowScrollY(201);
      await paint();
      assert.ok(button(), "the window scroller shows the button past 200px");
      setWindowScrollY(0);
      await React.act(async () => {
        window.dispatchEvent(new window.Event("scroll"));
      });
      assert.equal(button() === null, true, "scrolling the window back to the top hides the button");
    });
  });

  await t.test("follows the ticket scroller once it exists", async () => {
    const controls = controlsFor();
    controls.flagOn = true;
    await withPage(controls, async ({ window, paint, button, flushFrames, windowScrollListeners, setWindowScrollY }) => {
      setWindowScrollY(800);
      await paint();
      await flushFrames();
      assert.equal(button() === null, true, "a missing ticket scroller does not use the window scroll position");
      assert.equal(windowScrollListeners.size, 0, "the button does not listen to the window while the ticket scroller is missing");

      const element = scrollable(window.document, 0);
      controls.scrollElement = element;
      await flushFrames();
      assert.equal(button() === null, true, "the button stays hidden when the ticket scroller is at the top");

      element.scrollTop = 201;
      await React.act(async () => {
        element.dispatchEvent(new window.Event("scroll"));
      });
      assert.ok(button(), "scrolling the ticket shows the button");

      element.scrollTop = 0;
      await React.act(async () => {
        element.dispatchEvent(new window.Event("scroll"));
      });
      assert.equal(button() === null, true, "the window scroll position does not keep the button visible");
      assert.equal(windowScrollListeners.size, 0);
    });
  });
});
