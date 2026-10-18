const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const origin = "https://app.hypertask.ai";
const flagKey = "htpr-7321-canvas-links";
let enabled = true;
const pushes = [];
const router = { push: (value) => pushes.push(value) };
const mocks = {
  "next/navigation": { useRouter: () => router, usePathname: () => "/page/example" },
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
const { resolveCanvasLink } = load("src/components/RTE/Extensions/HtmlBlock/canvasLink.ts");
mocks["./buildSrcDoc"] = { buildHtmlBlockSrcDoc };
mocks["./canvasLink"] = { resolveCanvasLink };
const { HtmlCanvasFrame } = load("src/components/RTE/Extensions/HtmlBlock/HtmlCanvasFrame.tsx");

function withCanvas(html, options, run) {
  const dom = new JSDOM(buildHtmlBlockSrcDoc(html, options.gallery ?? false, options.enabled ?? true), {
    runScripts: "dangerously", url: `${origin}/page/example`,
  });
  const messages = [];
  dom.window.parent.postMessage = (data, targetOrigin) => messages.push({ data, targetOrigin });
  const click = (selector, init = {}, type = "click") => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    dom.window.document.querySelector(selector).dispatchEvent(event);
    return event;
  };
  try {
    run({ dom, messages, click });
  } finally {
    dom.window.close();
  }
}

test("canvas HTTP links hand their absolute URL to the parent rather than navigating the iframe", () => {
  withCanvas('<a href="/detail/project-15/7321?view=test#comment-42"><span>Ticket</span></a>', {}, ({ messages, click }) => {
    assert.equal(click("span").defaultPrevented, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].data.__htHtmlBlockLink, 1);
    assert.equal(messages[0].data.href, `${origin}/detail/project-15/7321?view=test#comment-42`);
    assert.equal(messages[0].data.newTab, false);
    assert.equal(messages[0].targetOrigin, "*");
  });
});

test("modified clicks, middle clicks and blank targets request a new tab", () => {
  for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
    withCanvas('<a href="https://example.com/path">External</a>', {}, ({ messages, click }) => {
      assert.equal(click("a", init, init.button === 1 ? "auxclick" : "click").defaultPrevented, true);
      assert.equal(messages.length, 1);
      assert.equal(messages[0].data.newTab, true);
      assert.equal(messages[0].data.href, "https://example.com/path");
    });
  }
  withCanvas('<a href="http://example.com" target="_blank">External</a>', {}, ({ messages, click }) => {
    click("a");
    assert.equal(messages[0].data.newTab, true);
  });
});

test("fragment links stay within the canvas and scroll by decoded id or name", () => {
  withCanvas('<a href="#x%20y">Id</a><a href="#named">Name</a><a href="#missing">Missing</a><a href="#%ZZ">Malformed</a><div id="x y"></div><a name="named"></a>', {}, ({ dom, messages, click }) => {
    const scrolled = [];
    dom.window.document.getElementById("x y").scrollIntoView = () => scrolled.push("id");
    dom.window.document.getElementsByName("named")[0].scrollIntoView = () => scrolled.push("name");
    for (const selector of ['a[href="#x%20y"]', 'a[href="#named"]', 'a[href="#missing"]', 'a[href="#%ZZ"]']) {
      assert.equal(click(selector).defaultPrevented, true);
    }
    assert.deepEqual(scrolled, ["id", "name"]);
    assert.equal(messages.length, 0);
  });
});

test("non-HTTP protocols, prevented events, right clicks and non-links are not handed off", () => {
  withCanvas('<a href="javascript:alert(1)">Script</a><a href="mailto:test@example.com">Mail</a><a href="https://example.com">Web</a><button>Button</button>', {}, ({ dom, messages, click }) => {
    assert.equal(click('a[href^="javascript:"]').defaultPrevented, false);
    assert.equal(click('a[href^="mailto:"]').defaultPrevented, false);
    assert.equal(click('a[href^="https:"]', { button: 2 }, "auxclick").defaultPrevented, false);
    click("button");
    dom.window.document.querySelector('a[href^="https:"]').addEventListener("click", (event) => event.preventDefault());
    assert.equal(click('a[href^="https:"]').defaultPrevented, true);
    assert.equal(messages.length, 0);
  });
});

test("flag off leaves link clicks untouched and image gallery keeps priority for linked images", () => {
  withCanvas('<a href="https://example.com">External</a>', { enabled: false }, ({ messages, click }) => {
    assert.equal(click("a").defaultPrevented, false);
    assert.equal(messages.length, 0);
  });
  withCanvas('<a href="https://example.com"><img src="https://example.com/image.png"></a>', { gallery: true }, ({ messages, click }) => {
    assert.equal(click("img").defaultPrevented, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].data.__htPageImage, 1);
  });
});

test("URL resolution preserves internal paths and isolates external and look-alike origins", () => {
  assert.deepEqual(resolveCanvasLink(`${origin}/detail/project-15/7321?x=1#comment-42`, origin), {
    kind: "internal", path: "/detail/project-15/7321?x=1#comment-42",
  });
  assert.deepEqual(resolveCanvasLink(origin, origin), { kind: "internal", path: "/" });
  for (const url of ["https://example.com/path", "http://app.hypertask.ai/", "https://app.hypertask.ai.evil.com/", "https://app.hypertask.ai:8443/"]) {
    assert.deepEqual(resolveCanvasLink(url, origin), { kind: "external", url });
  }
  for (const value of [undefined, null, 42, {}, "", "not a url", "/relative", "javascript:alert(1)", "mailto:test@example.com", "data:text/html,test", "ftp://example.com"]) {
    assert.equal(resolveCanvasLink(value, origin), null);
  }
});

async function withFrame(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: `${origin}/page/example` });
  const names = ["window", "document", "Element", "HTMLIFrameElement", "DOMParser", "IS_REACT_ACT_ENVIRONMENT"];
  const previous = names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]);
  for (const name of names) global[name] = name === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[name];
  pushes.length = 0;
  enabled = true;
  const opened = [];
  dom.window.open = (...args) => opened.push(args);
  const reactRoot = createRoot(document.getElementById("root"));
  const render = async () => React.act(async () => reactRoot.render(React.createElement(HtmlCanvasFrame, { html: '<a href="https://example.com">Link</a>' })));
  const message = async (data, source = document.querySelector("iframe").contentWindow) => React.act(async () => {
    window.dispatchEvent(new dom.window.MessageEvent("message", { data, source }));
  });
  try {
    await render();
    await run({ dom, opened, message, render });
  } finally {
    await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

test("frame routes internal links and opens absolute external or new-tab links with noopener", async () => {
  await withFrame(async ({ opened, message }) => {
    assert.equal(document.querySelector("iframe").getAttribute("sandbox"), "allow-scripts");
    await message({ __htHtmlBlockLink: 1, href: `${origin}/detail/project-15/7321?x=1#comment-42`, newTab: false });
    assert.deepEqual(pushes, ["/detail/project-15/7321?x=1#comment-42"]);
    await message({ __htHtmlBlockLink: 1, href: "https://example.com/path", newTab: false });
    await message({ __htHtmlBlockLink: 1, href: `${origin}/detail/project-15/7321`, newTab: true });
    assert.deepEqual(opened, [
      ["https://example.com/path", "_blank", "noopener,noreferrer"],
      [`${origin}/detail/project-15/7321`, "_blank", "noopener,noreferrer"],
    ]);
  });
});

test("foreign sources and invalid URLs are refused while the actual frame source is still allowed", async () => {
  await withFrame(async ({ opened, message }) => {
    const data = { __htHtmlBlockLink: 1, href: `${origin}/detail/project-15/7321` };
    await message(data, window);
    for (const href of [null, 42, "javascript:alert(1)", "not a url"]) await message({ ...data, href });
    await message({ ...data, __htHtmlBlockLink: true });
    await message(null);
    assert.deepEqual(pushes, []);
    assert.deepEqual(opened, []);
    await message(data);
    assert.deepEqual(pushes, ["/detail/project-15/7321"]);
    await message({ __htHtmlBlock: 1, h: 240.5 });
    assert.equal(document.querySelector("iframe").style.height, "241px");
  });
});

test("changing the flag disables and re-enables parent link handling without changing the sandbox", async () => {
  await withFrame(async ({ opened, message, render }) => {
    const data = { __htHtmlBlockLink: 1, href: `${origin}/detail/project-15/7321` };
    enabled = false;
    await render();
    await message(data);
    await message({ ...data, href: "https://example.com" });
    assert.deepEqual(pushes, []);
    assert.deepEqual(opened, []);
    assert.equal(document.querySelector("iframe").getAttribute("sandbox"), "allow-scripts");
    enabled = true;
    await render();
    await message(data);
    assert.deepEqual(pushes, ["/detail/project-15/7321"]);
  });
});

test("canvas link flag is a small-risk bugfix enabled for everyone", () => {
  const definition = require("./helpers/flag-files.cjs").definitions().find((item) => item.key === flagKey);
  assert.ok(definition);
  assert.equal(mocks["@/lib/flags/keys"].HTPR_7321_CANVAS_LINKS_FLAG, flagKey);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.shippedOn, "2026-10-18");
  assert.deepEqual(definition.releaseRisk, {
    risk: "small",
    reason: "Links in HTML canvas pages open the ticket in the app or a new tab instead of inside the page frame.",
  });
});
