const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { loadModule } = require("./helpers/loadModule.cjs");

const FLAG_KEY = "htpr-8998-ticket-jump-to-top";
const BUTTON = "src/components/PageComponents/TaskDetail/JumpToTopButton.tsx";

function loadButton(flagOn) {
  return loadModule(BUTTON, {
    "@/hooks/useFlag": { useFlag: (key) => key === FLAG_KEY && flagOn },
    "lucide-react": { ChevronUp: () => React.createElement("svg", { "data-icon": "chevron-up" }) },
    "@/components/Common/Tooltip": {
      default: ({ text, keyCombination }) =>
        React.createElement("span", { "data-tooltip": text, "data-keys": keyCombination.join(" ") }),
    },
  }).default;
}

function ticketScroller() {
  const element = document.createElement("div");
  let offset = 0;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => offset,
    set: (value) => {
      offset = Number(value);
    },
  });
  const scrolls = [];
  element.scrollTo = (options) => scrolls.push(options);
  return { element, scrolls };
}

async function withPage(run) {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://app.hypertask.ai/detail/project-15/8998" });
  const names = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]));
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    return await run(dom.window);
  } finally {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    dom.window.close();
  }
}

async function mount(Button, element) {
  const host = document.getElementById("root");
  const reactRoot = createRoot(host);
  await React.act(async () => {
    reactRoot.render(React.createElement(Button, { scrollElementRef: { current: element } }));
  });
  return {
    button: () => host.querySelector("[data-testid='jump-to-top']"),
    scrollTo: (offset) =>
      React.act(async () => {
        element.scrollTop = offset;
        element.dispatchEvent(new window.Event("scroll"));
      }),
    unmount: () => React.act(async () => reactRoot.unmount()),
  };
}

test("jump to top is a new feature held at owner and qa", () => {
  const definition = loadModule("src/lib/flags/definitions/htpr-8998-ticket-jump-to-top.ts").default;
  assert.equal(definition.key, FLAG_KEY);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.risk, "new");
  assert.match(definition.releaseRisk.reason, /Off hides the button/);
});

test("flag off leaves the ticket page without a jump to top button", async () => {
  await withPage(async () => {
    const scroller = ticketScroller();
    const page = await mount(loadButton(false), scroller.element);
    await page.scrollTo(900);
    assert.equal(page.button(), null, "flag off never shows the button");
    await page.unmount();
  });
});

test("flag on shows a square 32px button after the ticket scrolls and jumps to the top", async () => {
  await withPage(async () => {
    const scroller = ticketScroller();
    const page = await mount(loadButton(true), scroller.element);
    assert.equal(page.button(), null, "a ticket at the top stays clean");

    await page.scrollTo(200);
    assert.equal(page.button(), null, "200px is not far enough down");

    await page.scrollTo(201);
    const button = page.button();
    assert.ok(button, "a scrolled ticket shows the button");
    assert.match(button.className, /\bh-8\b/);
    assert.match(button.className, /\bw-8\b/);
    assert.match(button.className, /rounded-\[4px\]/);
    assert.equal(button.getAttribute("aria-label"), "Jump to top");
    assert.ok(button.querySelector("[data-icon='chevron-up']"));
    assert.equal(button.querySelector("[data-tooltip]").getAttribute("data-tooltip"), "Jump to top");
    assert.equal(button.querySelector("[data-tooltip]").getAttribute("data-keys"), "G G");

    await React.act(async () => {
      button.click();
    });
    assert.deepEqual(scroller.scrolls, [{ top: 0, behavior: "smooth" }]);

    await page.scrollTo(0);
    assert.equal(page.button(), null, "back at the top the button goes away again");
    await page.unmount();
  });
});

test("a ticket that is already scrolled when the button mounts shows it at once", async () => {
  await withPage(async () => {
    const scroller = ticketScroller();
    scroller.element.scrollTop = 640;
    const page = await mount(loadButton(true), scroller.element);
    assert.ok(page.button());
    await page.unmount();
  });
});

test("reduced motion jumps without the smooth scroll", async () => {
  await withPage(async () => {
    const previous = globalThis.matchMedia;
    globalThis.matchMedia = () => ({ matches: true });
    try {
      const scroller = ticketScroller();
      scroller.element.scrollTop = 500;
      const page = await mount(loadButton(true), scroller.element);
      await React.act(async () => {
        page.button().click();
      });
      assert.deepEqual(scroller.scrolls, [{ top: 0, behavior: "auto" }]);
      await page.unmount();
    } finally {
      globalThis.matchMedia = previous;
    }
  });
});
