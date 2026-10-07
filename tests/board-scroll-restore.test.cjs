const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const flag = "htpr-6998-board-scroll-restore";
const hookFile = "src/hooks/Kanban/useBoardScrollRestore.ts";

async function fixture(run, { mobile = false, enabled = true, pageScroll = false } = {}) {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai/project?id=15" });
  const names = ["window", "document", "navigator", "HTMLElement", "MutationObserver", "ResizeObserver", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]);
  const resizeObservers = new Set();
  class ResizeObserver {
    constructor(callback) { this.callback = callback; resizeObservers.add(this); }
    observe() {}
    disconnect() { resizeObservers.delete(this); }
  }
  for (const name of names) Object.defineProperty(global, name, {
    configurable: true,
    value: name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "ResizeObserver" ? ResizeObserver : dom.window[name],
  });
  Object.defineProperty(document, "scrollingElement", { value: document.documentElement });
  let boardUrl = "/project?id=15";
  let flagOn = enabled;
  const frames = new Map();
  let frameId = 0;
  window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, hookFile), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  const mocks = {
    "@/hooks/useFlag": { useFlag: key => { assert.equal(key, flag); return flagOn; } },
    "@/lib/flags/keys": { HTPR_6998_BOARD_SCROLL_RESTORE_FLAG: flag },
    "next/navigation": {
      usePathname: () => boardUrl.split("?")[0],
      useSearchParams: () => new URLSearchParams(boardUrl.split("?")[1]),
    },
  };
  new Function("require", "module", "exports", compiled)(name => mocks[name] ?? require(name), loaded, loaded.exports);
  const { useBoardScrollRestore } = loaded.exports;
  let contentHeight = 1400;
  let contentWidth = 1600;
  const measured = new WeakSet();
  function dimensions(element, horizontal = false) {
    if (!element || measured.has(element)) return;
    measured.add(element);
    let position = 0;
    const property = horizontal ? "scrollLeft" : "scrollTop";
    Object.defineProperties(element, horizontal ? {
      scrollWidth: { configurable: true, get: () => contentWidth },
      clientWidth: { configurable: true, value: 390 },
    } : {
      scrollHeight: { configurable: true, get: () => contentHeight },
      clientHeight: { configurable: true, value: 500 },
    });
    Object.defineProperty(element, property, {
      configurable: true, get: () => position,
      set: value => { position = Math.max(0, Math.min(value, horizontal ? contentWidth - 390 : contentHeight - 500)); },
    });
  }
  function Board({ ready = true, cards = true, moduleReady = true, mountScroll, order = [10, 20] }) {
    useBoardScrollRestore(mobile, ready);
    React.useEffect(() => {
      if (mountScroll === undefined) return;
      const column = document.getElementById("droppable-section-container-10");
      const scroller = mobile ? column.querySelector("[id^='tasks-list-']") : column;
      scroller.scrollTop = mountScroll;
      scroller.dispatchEvent(new window.Event("scroll"));
    }, [mountScroll]);
    return React.createElement("div", { id: "kanban-sections-container", className: "homepage-container-tag", ref: element => dimensions(element, true) },
      React.createElement("div", { id: "sectionsContainer" }, order.map((id, index) =>
        React.createElement("div", { key: id, id: `droppable-section-container-${id}`, "data-board-scroll-ready": moduleReady, ref: element => { if (!mobile) dimensions(element); } },
          React.createElement("div", { id: `tasks-list-${index}`, ref: element => { if (mobile) dimensions(element); } },
            cards && React.createElement("div", { "data-card": id }, "Loaded card")),
        ),
      )),
    );
  }
  if (pageScroll) dimensions(document.scrollingElement, true);
  const { createRoot } = require("react-dom/client");
  const reactRoot = createRoot(document.getElementById("root"));
  const flush = async () => React.act(async () => {
    await Promise.resolve();
    const current = [...frames.values()];
    frames.clear();
    current.forEach(callback => callback(0));
    await Promise.resolve();
  });
  const render = async props => {
    await React.act(async () => reactRoot.render(React.createElement(Board, props)));
    await flush();
  };
  const scrollers = () => ({
    strip: document.getElementById("kanban-sections-container"),
    columns: [...document.querySelectorAll("[id^='droppable-section-container-']")].map(column => mobile ? column.querySelector("[id^='tasks-list-']") : column),
  });
  const scroll = (element, property, value) => {
    element[property] = value;
    element.dispatchEvent(new window.Event("scroll"));
  };
  const leave = async () => {
    window.history.pushState({}, "", "/search?q=test&fromProject=15");
    await React.act(async () => reactRoot.render(null));
  };
  const back = async (props = {}) => {
    await new Promise(resolve => {
      window.addEventListener("popstate", resolve, { once: true });
      window.history.back();
    });
    boardUrl = window.location.pathname + window.location.search;
    await render(props);
  };
  try {
    await run({ render, flush, scrollers, scroll, leave, back, dom, resizeObservers,
      setUrl: url => { boardUrl = url; window.history.replaceState({}, "", url); },
      setEnabled: value => { flagOn = value; },
      setHeight: value => { contentHeight = value; }, setWidth: value => { contentWidth = value; },
    });
  } finally {
    await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

for (const mobile of [false, true]) {
  for (const enabled of [false, true]) {
    test(`${mobile ? "phone" : "desktop"}, flag ${enabled ? "on" : "off"}: history return restores both columns and horizontal strip`, async () => fixture(async f => {
      await f.render();
      const before = f.scrollers();
      f.scroll(before.columns[0], "scrollTop", 283);
      f.scroll(before.columns[1], "scrollTop", 120);
      f.scroll(before.strip, "scrollLeft", 411);
      await f.leave();
      await f.back();
      const after = f.scrollers();
      assert.notEqual(after.columns[0], before.columns[0], "the board really remounts");
      assert.deepEqual(after.columns.map(column => column.scrollTop), enabled ? [283, 120] : [0, 0]);
      assert.equal(after.strip.scrollLeft, enabled ? 411 : 0);
      if (mobile) assert.equal(document.getElementById("droppable-section-container-10").scrollTop, 0);
    }, { mobile, enabled }));
  }

  test(`${mobile ? "phone" : "desktop"}: late active-card focus after completed restoration cannot erase saved scroll`, async () => fixture(async f => {
    await f.render();
    let s = f.scrollers();
    f.scroll(s.columns[0], "scrollTop", 460);
    f.scroll(s.columns[1], "scrollTop", 120);
    f.scroll(s.strip, "scrollLeft", 140);
    await f.leave(); await f.back();
    s = f.scrollers();
    assert.equal(s.columns[0].scrollTop, 460, "the first restoration already completed");
    assert.equal(f.resizeObservers.size, 0);
    const card = document.createElement("div");
    card.tabIndex = 0;
    s.columns[0].append(card);
    // Browsers scroll a newly focused card before delivering queued scroll events;
    // JSDOM delivers focusin but does not implement the focus-induced scrolling.
    s.columns[0].scrollTop = 0;
    card.focus();
    s.strip.dispatchEvent(new window.Event("scroll"));
    s.columns[0].dispatchEvent(new window.Event("scroll"));
    assert.equal(JSON.parse(window.sessionStorage.getItem("htpr-6998-board-scroll:/project?id=15"))["droppable-section-container-10"], 460);
    await f.flush();
    assert.deepEqual(s.columns.map(column => column.scrollTop), [460, 120]);
    assert.equal(s.strip.scrollLeft, 140);
    f.scroll(s.columns[0], "scrollTop", 460);
    assert.equal(JSON.parse(window.sessionStorage.getItem("htpr-6998-board-scroll:/project?id=15"))["droppable-section-container-10"], 460);
  }, { mobile }));

  test(`${mobile ? "phone" : "desktop"}: pointer interaction releases completed restoration focus protection`, async () => fixture(async f => {
    await f.render(); f.scroll(f.scrollers().columns[0], "scrollTop", 460);
    await f.leave(); await f.back();
    const column = f.scrollers().columns[0];
    const card = document.createElement("div");
    card.tabIndex = 0;
    column.append(card);
    column.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    column.scrollTop = 0;
    card.focus();
    column.dispatchEvent(new window.Event("scroll"));
    await f.flush();
    assert.equal(column.scrollTop, 0, "normal user focus is allowed to scroll");
    assert.equal(JSON.parse(window.sessionStorage.getItem("htpr-6998-board-scroll:/project?id=15"))["droppable-section-container-10"], 0);
  }, { mobile }));

  test(`${mobile ? "phone" : "desktop"}: waits for hydrated data and asynchronous card layout, preserving section identity after reorder`, async () => fixture(async f => {
    await f.render();
    let s = f.scrollers();
    f.scroll(s.columns[0], "scrollTop", 283);
    f.scroll(s.columns[1], "scrollTop", 120);
    f.scroll(s.strip, "scrollLeft", 411);
    await f.leave();
    f.setHeight(100); f.setWidth(390);
    await f.back({ ready: false, cards: false, order: [20, 10] });
    assert.deepEqual(f.scrollers().columns.map(column => column.scrollTop), [0, 0]);
    await f.render({ ready: true, cards: false, order: [20, 10] });
    f.setHeight(1400); f.setWidth(1600);
    await f.render({ cards: true, order: [20, 10] });
    s = f.scrollers();
    assert.deepEqual(s.columns.map(column => column.scrollTop), [120, 283]);
    assert.equal(s.strip.scrollLeft, 411);
    assert.equal(f.resizeObservers.size, 0, "restoration observers disconnect once complete");
  }, { mobile }));

  test(`${mobile ? "phone" : "desktop"}: waits for card modules even when skeletons already provide enough scroll range`, async () => fixture(async f => {
    await f.render(); f.scroll(f.scrollers().columns[0], "scrollTop", 283);
    await f.leave(); await f.back({ moduleReady: false });
    assert.equal(f.scrollers().columns[0].scrollTop, 0);
    await f.render({ moduleReady: true });
    assert.equal(f.scrollers().columns[0].scrollTop, 283);
  }, { mobile }));
}

test("mount-time focus scrolling cannot cancel the first restoration frame", async () => fixture(async f => {
  await f.render(); f.scroll(f.scrollers().columns[0], "scrollTop", 283);
  await f.leave(); await f.back({ mountScroll: 50 });
  assert.equal(f.scrollers().columns[0].scrollTop, 283);
}));

test("layout-only resize restores pending positions without a DOM mutation", async () => fixture(async f => {
  await f.render(); f.scroll(f.scrollers().columns[0], "scrollTop", 283);
  await f.leave(); f.setHeight(100); await f.back();
  f.setHeight(1400);
  for (const observer of f.resizeObservers) observer.callback([]);
  await f.flush();
  assert.equal(f.scrollers().columns[0].scrollTop, 283);
  assert.equal(f.resizeObservers.size, 0);
}));

test("non-rail desktop also restores horizontal page scrolling", async () => fixture(async f => {
  await f.render();
  f.scroll(document.scrollingElement, "scrollLeft", 321);
  await f.leave();
  document.scrollingElement.scrollLeft = 0;
  await f.back();
  assert.equal(document.scrollingElement.scrollLeft, 321);
}, { pageScroll: true }));

for (const interaction of ["wheel", "touchmove", "keydown", "scroll"]) {
  test(`${interaction} cancels pending restoration and later cards cannot fight the user`, async () => fixture(async f => {
    await f.render();
    f.scroll(f.scrollers().columns[0], "scrollTop", 800);
    await f.leave();
    f.setHeight(600);
    await f.back({ cards: false });
    const column = f.scrollers().columns[0];
    if (interaction === "scroll") f.scroll(column, "scrollTop", 50);
    else {
      column.dispatchEvent(interaction === "keydown"
        ? new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
        : new window.Event(interaction, { bubbles: true }));
      f.scroll(column, "scrollTop", 50);
    }
    f.setHeight(1800);
    await f.render({ cards: true });
    assert.equal(column.scrollTop, 50);
    assert.equal(f.resizeObservers.size, 0);
  }));
}

test("programmatic restoration scroll events do not cancel other pending columns", async () => fixture(async f => {
  await f.render();
  const s = f.scrollers();
  f.scroll(s.columns[0], "scrollTop", 283); f.scroll(s.columns[1], "scrollTop", 800);
  await f.leave(); f.setHeight(900);
  await f.back({ cards: false });
  f.scrollers().columns[0].dispatchEvent(new window.Event("scroll"));
  f.setHeight(1800); await f.render({ cards: true });
  assert.deepEqual(f.scrollers().columns.map(column => column.scrollTop), [283, 800]);
}));

test("different board URLs and views do not inherit saved positions; exact-URL link revisits also restore", async () => fixture(async f => {
  await f.render(); f.scroll(f.scrollers().columns[0], "scrollTop", 283);
  await f.leave();
  f.setUrl("/project?id=16"); await f.render();
  assert.equal(f.scrollers().columns[0].scrollTop, 0);
  await f.leave();
  f.setUrl("/project?id=15&view=other"); await f.render();
  assert.equal(f.scrollers().columns[0].scrollTop, 0);
  await f.leave();
  f.setUrl("/project?id=15"); await f.render();
  assert.equal(f.scrollers().columns[0].scrollTop, 283);
}));

test("turning the flag off on return ignores existing saved scroll", async () => fixture(async f => {
  await f.render(); f.scroll(f.scrollers().columns[0], "scrollTop", 283);
  await f.leave(); f.setEnabled(false); await f.back();
  assert.equal(f.scrollers().columns[0].scrollTop, 0);
  assert.equal(f.resizeObservers.size, 0);
}));

for (const operation of ["getItem", "setItem"]) {
  test(`blocked sessionStorage ${operation} is harmless`, async () => fixture(async f => {
    f.dom.window.Storage.prototype[operation] = () => { throw new Error("Storage blocked"); };
    await f.render();
    f.scroll(f.scrollers().columns[0], "scrollTop", 283);
    await f.leave(); await f.back();
    assert.equal(f.scrollers().columns[0].scrollTop, 0);
  }));
}

test("malformed stored positions are harmless", async () => fixture(async f => {
  await f.render(); f.scroll(f.scrollers().columns[0], "scrollTop", 283);
  await f.leave();
  for (const key of Object.keys(window.sessionStorage)) window.sessionStorage.setItem(key, "{broken");
  await f.back(); assert.equal(f.scrollers().columns[0].scrollTop, 0);
}));

test("the real kanban mounts the restoration hook with its phone layout and task hydration state", () => {
  const file = "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx";
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "useBoardScrollRestore") calls.push(node.arguments.map(arg => arg.getText(source)));
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.deepEqual(calls, [["_mbl", "tasksHydrated"]]);
});
