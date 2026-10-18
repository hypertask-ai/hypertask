const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const origin = "https://app.hypertask.ai";
const flagKey = "htpr-7321-canvas-links";
let enabled = true;
const mocks = {
  "next/navigation": { usePathname: () => "/page/example" },
  "@/hooks/useFlag": { useFlag: (key) => key === flagKey && enabled },
  "@/lib/flags/keys": require("./helpers/flag-files.cjs").load("src/lib/flags/keys.ts"),
};

function compile(relativePath) {
  return ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
}

function load(relativePath) {
  const target = { exports: {} };
  new Function("require", "module", "exports", compile(relativePath))(
    (specifier) => specifier in mocks ? { __esModule: true, ...mocks[specifier] } : require(specifier), target, target.exports,
  );
  return target.exports;
}

const canvasLinksSource = compile("src/components/RTE/Extensions/HtmlBlock/canvasLinks.ts");
mocks["./canvasLinks"] = load("src/components/RTE/Extensions/HtmlBlock/canvasLinks.ts");
const { LINK_PORT_MESSAGE, LINK_READY_MESSAGE } = mocks["./canvasLinks"];
const { buildHtmlBlockSrcDoc } = load("src/components/RTE/Extensions/HtmlBlock/buildSrcDoc.ts");
mocks["./buildSrcDoc"] = { buildHtmlBlockSrcDoc };
const { HtmlCanvasFrame } = load("src/components/RTE/Extensions/HtmlBlock/HtmlCanvasFrame.tsx");

const canvasHtml = [
  '<!doctype html><html><head><title>Links</title></head><body>',
  '<p><a id="ticket" href="https://app.hypertask.ai/detail/project-15/7321">Ticket</a></p>',
  '<p><a id="script" href="javascript:void(0)">Script</a></p>',
  '<p><a id="anchor" href="#bottom">Anchor</a></p>',
  '<div style="height:400px"></div><p id="bottom">Bottom</p>',
  '</body></html>',
].join("");

test("flag on puts the link script in the head before any canvas content; flag off leaves the canvas as before", () => {
  const on = buildHtmlBlockSrcDoc('<html><head><script>window.mine=1</script></head><body>x</body></html>', false, true);
  const scriptAt = on.indexOf(LINK_READY_MESSAGE);
  assert.ok(scriptAt > 0);
  assert.ok(scriptAt < on.indexOf("window.mine=1"));
  assert.ok(scriptAt < on.indexOf("</head>"));
  const off = buildHtmlBlockSrcDoc('<html><head><script>window.mine=1</script></head><body>x</body></html>', false, false);
  assert.equal(off.includes(LINK_READY_MESSAGE), false);
  assert.equal(off, buildHtmlBlockSrcDoc('<html><head><script>window.mine=1</script></head><body>x</body></html>'));
});

async function withRenderedFrame(flagOn, run) {
  const dom = new JSDOM('<div id="root"></div>', { url: `${origin}/page/example` });
  const names = ["window", "document", "Element", "HTMLIFrameElement", "DOMParser", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) global[name] = name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name];
  enabled = flagOn;
  const reactRoot = createRoot(document.getElementById("root"));
  try {
    await React.act(async () => reactRoot.render(React.createElement(HtmlCanvasFrame, { html: canvasHtml })));
    const frame = document.querySelector("iframe");
    const sent = [];
    frame.contentWindow.postMessage = (...args) => sent.push(args);
    const message = (data, source = frame.contentWindow) => React.act(async () => {
      window.dispatchEvent(new dom.window.MessageEvent("message", { data, source }));
    });
    await run({ frame, sent, message });
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

test("the app hands one private link channel to its own canvas, once, and keeps the scripts-only sandbox", async () => {
  await withRenderedFrame(true, async ({ frame, sent, message }) => {
    assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
    await message({ [LINK_READY_MESSAGE]: 1 }, window);
    assert.equal(sent.length, 0);
    await message({ [LINK_READY_MESSAGE]: 1 });
    await message({ [LINK_READY_MESSAGE]: 1 });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0][0], { [LINK_PORT_MESSAGE]: 1 });
    assert.equal(sent[0][2].length, 1);
    sent[0][2][0].close();
    await message({ __htHtmlBlock: 1, h: 240.5 });
    assert.equal(frame.style.height, "241px");
  });
});

test("flag off never hands out a link channel and keeps resizing", async () => {
  await withRenderedFrame(false, async ({ frame, sent, message }) => {
    await message({ [LINK_READY_MESSAGE]: 1 });
    assert.equal(sent.length, 0);
    assert.equal(frame.getAttribute("sandbox"), "allow-scripts");
    await message({ __htHtmlBlock: 1, h: 300 });
    assert.equal(frame.style.height, "300px");
  });
});

const hostileCanvases = {
  "fakes the handshake before the real one": '<script>var own=new MessageChannel();dispatchEvent(new MessageEvent("message",{source:parent,data:{__htHtmlBlockLinkPort:1},ports:[own.port2]}));addEventListener("message",function(e){if(e.ports&&e.ports[0])setInterval(function(){e.ports[0].postMessage({href:"https://evil.example/"})},50)},true)</script>',
  "re-asks for the channel": '<script>setInterval(function(){parent.postMessage({__htHtmlBlockLinkReady:1},"*")},50)</script>',
  "steals the channel through patched built-ins": '<script>var g=Object.getOwnPropertyDescriptor(MessageEvent.prototype,"ports").get;function spam(p){if(p&&p[0])setInterval(function(){p[0].postMessage({href:"https://evil.example/"})},50)}Object.defineProperty(MessageEvent.prototype,"ports",{get:function(){var p=g.call(this);spam(p);return p}});addEventListener("message",function(e){spam(g.call(e))},true)</script>',
  "navigates itself to its own document": '<script>location.href="data:text/html,<script>parent.postMessage({__htHtmlBlockLinkReady:1},\'*\');addEventListener(\'message\',function(e){if(e.ports[0])setInterval(function(){e.ports[0].postMessage({href:\'https://evil.example/\'})},50)});document.write(\'<button id=ticket>x</button>\')<\\/script>"</script>',
};

async function withBrowserCanvas(extra, run) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/^https:\/\/(app\.hypertask\.ai|evil\.example)\//, (route) => route.fulfill({
    contentType: "text/html", body: '<html><body><button id="outside">Outside</button></body></html>',
  }));
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/page/example`);
    await page.evaluate(([links, srcDoc, ready]) => {
      const exports = {};
      new Function("exports", links)(exports);
      window.__opened = [];
      const open = window.open.bind(window);
      window.open = (...args) => { window.__opened.push(args); return open(...args); };
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.style.height = "600px";
      let port = null;
      addEventListener("message", (event) => {
        if (event.source === frame.contentWindow && !port && event.data?.[ready] === 1) port = exports.openLinksClickedIn(frame);
      });
      frame.srcdoc = srcDoc;
      document.body.appendChild(frame);
    }, [canvasLinksSource, buildHtmlBlockSrcDoc(extra + canvasHtml, false, true), LINK_READY_MESSAGE]);
    await page.waitForTimeout(1000);
    await run({ page, context, frame: page.frameLocator("iframe") });
  } finally {
    await browser.close();
  }
}

test("a real click on a canvas web link opens one new tab with no opener and leaves the app where it was", async () => {
  await withBrowserCanvas("", async ({ page, context, frame }) => {
    const tab = context.waitForEvent("page");
    await frame.locator("#ticket").click();
    const opened = await tab;
    assert.equal(opened.url(), "https://app.hypertask.ai/detail/project-15/7321");
    assert.equal(await opened.evaluate(() => window.opener), null);
    await frame.locator("#ticket").click();
    await page.waitForTimeout(500);
    assert.deepEqual((await page.evaluate(() => window.__opened)).map(([url, target, features]) => [url, target, features]), [
      ["https://app.hypertask.ai/detail/project-15/7321", "_blank", "noopener,noreferrer"],
      ["https://app.hypertask.ai/detail/project-15/7321", "_blank", "noopener,noreferrer"],
    ]);
    assert.equal(page.url(), `${origin}/page/example`);
    assert.equal(await frame.locator("#ticket").count(), 1);
  });
});

test("anchors scroll inside the canvas and javascript links open nothing", async () => {
  await withBrowserCanvas("", async ({ page, frame }) => {
    await frame.locator("#anchor").click();
    await frame.locator("#script").click();
    await page.waitForTimeout(500);
    assert.equal(await frame.locator("#ticket").count(), 1);
    assert.deepEqual(await page.evaluate(() => window.__opened), []);
  });
});

for (const [name, attack] of Object.entries(hostileCanvases)) {
  test(`a canvas that ${name} cannot open other sites, even right after a real click`, async () => {
    await withBrowserCanvas(attack, async ({ page, frame }) => {
      const canvasDocument = () => page.frames().find((candidate) => candidate !== page.mainFrame());
      for (let waited = 0; attack.includes("data:text/html") && !canvasDocument()?.url().startsWith("data:") && waited < 5000; waited += 100) {
        await page.waitForTimeout(100);
      }
      await frame.locator("#ticket").waitFor();
      await page.waitForTimeout(500);
      await page.click("#outside");
      await frame.locator("#ticket").click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const opened = (await page.evaluate(() => window.__opened)).map(([url]) => url);
      assert.equal(opened.some((url) => url.includes("evil.example")), false, opened.join(", "));
      assert.equal(page.url(), `${origin}/page/example`);
    });
  });
}

test("canvas link flag is a small-risk bugfix enabled for everyone", () => {
  const definition = require("./helpers/flag-files.cjs").definitions().find((item) => item.key === flagKey);
  assert.ok(definition);
  assert.equal(mocks["@/lib/flags/keys"].HTPR_7321_CANVAS_LINKS_FLAG, flagKey);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-18");
});
