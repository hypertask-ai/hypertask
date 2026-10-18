const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM, VirtualConsole } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const origin = "https://app.hypertask.ai";
const flagKey = "htpr-7321-canvas-links";
let enabled = true;
const mocks = {
  "next/navigation": { usePathname: () => "/page/example" },
  "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
  "@/lib/flags/keys": require("./helpers/flag-files.cjs").load("src/lib/flags/keys.ts"),
};

function load(relativePath) {
  const target = { exports: {} };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", compiled)(
    (specifier) => specifier in mocks ? { __esModule: true, ...mocks[specifier] } : require(specifier), target, target.exports,
  );
  return target.exports;
}

const { buildHtmlBlockSrcDoc } = load("src/components/RTE/Extensions/HtmlBlock/buildSrcDoc.ts");
mocks["./buildSrcDoc"] = { buildHtmlBlockSrcDoc };
const { HtmlCanvasFrame } = load("src/components/RTE/Extensions/HtmlBlock/HtmlCanvasFrame.tsx");

function withCanvas(html, options, run) {
  const dom = new JSDOM(buildHtmlBlockSrcDoc(html, options.gallery ?? false, options.enabled ?? true), {
    runScripts: "dangerously", url: `${origin}/page/example`, virtualConsole: new VirtualConsole(),
  });
  const messages = [];
  dom.window.parent.postMessage = (data) => messages.push(data);
  const click = (selector, init = {}) => {
    const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ...init });
    dom.window.document.querySelector(selector).dispatchEvent(event);
    return event;
  };
  try {
    run({ dom, messages, click });
  } finally {
    dom.window.close();
  }
}

test("clicked web links open in a new tab without an opener instead of loading inside the canvas", () => {
  withCanvas('<a href="/detail/project-15/7321#comment-42"><span>Ticket</span></a><a href="https://example.com/path">External</a>', {}, ({ dom, messages, click }) => {
    assert.equal(click("span").defaultPrevented, false);
    assert.equal(click('a[href^="https:"]').defaultPrevented, false);
    for (const link of dom.window.document.querySelectorAll("a")) {
      assert.equal(link.target, "_blank");
      assert.equal(link.rel, "noopener noreferrer");
    }
    assert.equal(messages.length, 0);
  });
});

test("fragment links stay within the canvas and scroll by decoded id or name", () => {
  withCanvas('<a href="#x%20y">Id</a><a href="#named">Name</a><a href="#missing">Missing</a><a href="#%ZZ">Malformed</a><div id="x y"></div><a name="named"></a>', {}, ({ dom, click }) => {
    const scrolled = [];
    dom.window.document.getElementById("x y").scrollIntoView = () => scrolled.push("id");
    dom.window.document.getElementsByName("named")[0].scrollIntoView = () => scrolled.push("name");
    for (const selector of ['a[href="#x%20y"]', 'a[href="#named"]', 'a[href="#missing"]', 'a[href="#%ZZ"]']) {
      assert.equal(click(selector).defaultPrevented, true);
      assert.equal(dom.window.document.querySelector(selector).target, "");
    }
    assert.deepEqual(scrolled, ["id", "name"]);
  });
});

test("non-web links, links the canvas handles itself and non-links are left alone", () => {
  withCanvas('<a href="javascript:void(0)">Script</a><a href="mailto:test@example.com">Mail</a><a id="own" href="https://example.com">Own</a><button>Button</button>', {}, ({ dom, click }) => {
    click('a[href^="javascript:"]');
    click('a[href^="mailto:"]');
    click("button");
    dom.window.document.getElementById("own").addEventListener("click", (event) => event.preventDefault());
    click("#own");
    for (const link of dom.window.document.querySelectorAll("a")) assert.equal(link.target, "");
  });
});

test("flag off leaves links as before and the image gallery keeps priority for linked images", () => {
  withCanvas('<a href="https://example.com">External</a><a href="#x">Anchor</a>', { enabled: false }, ({ dom, click }) => {
    assert.equal(click('a[href^="https:"]').defaultPrevented, false);
    assert.equal(click('a[href="#x"]').defaultPrevented, false);
    assert.equal(dom.window.document.querySelector("a").target, "");
  });
  withCanvas('<a href="https://example.com"><img src="https://example.com/image.png"></a>', { gallery: true }, ({ dom, messages, click }) => {
    assert.equal(click("img").defaultPrevented, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].__htPageImage, 1);
    assert.equal(dom.window.document.querySelector("a").target, "");
  });
});

async function renderFrame(flagOn) {
  const dom = new JSDOM('<div id="root"></div>', { url: `${origin}/page/example` });
  const names = ["window", "document", "Element", "HTMLIFrameElement", "DOMParser", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) global[name] = name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name];
  enabled = flagOn;
  const reactRoot = createRoot(document.getElementById("root"));
  try {
    await React.act(async () => reactRoot.render(React.createElement(HtmlCanvasFrame, { html: '<a href="https://example.com">Link</a>' })));
    const frame = document.querySelector("iframe");
    await React.act(async () => {
      window.dispatchEvent(new dom.window.MessageEvent("message", { data: { __htHtmlBlock: 1, h: 240.5 }, source: frame.contentWindow }));
    });
    return { sandbox: frame.getAttribute("sandbox"), srcDoc: frame.getAttribute("srcdoc"), height: frame.style.height };
  } finally {
    await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
    enabled = true;
  }
}

test("flag on lets canvas links open new tabs but never navigate the app or reach its origin", async () => {
  const on = await renderFrame(true);
  assert.deepEqual(on.sandbox.split(" ").sort(), ["allow-popups", "allow-popups-to-escape-sandbox", "allow-scripts"]);
  assert.doesNotMatch(on.sandbox, /allow-top-navigation|allow-same-origin/);
  assert.match(on.srcDoc, /a\.target = '_blank'/);
  assert.equal(on.height, "241px");
});

test("flag off keeps today's scripts-only sandbox", async () => {
  const off = await renderFrame(false);
  assert.equal(off.sandbox, "allow-scripts");
  assert.doesNotMatch(off.srcDoc, /a\.target = '_blank'/);
  assert.equal(off.height, "241px");
});

test("canvas link flag is a small-risk bugfix enabled for everyone", () => {
  const definition = require("./helpers/flag-files.cjs").definitions().find((item) => item.key === flagKey);
  assert.ok(definition);
  assert.equal(mocks["@/lib/flags/keys"].HTPR_7321_CANVAS_LINKS_FLAG, flagKey);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-18");
});
