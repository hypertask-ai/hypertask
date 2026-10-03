const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

function fallbackUrl(src) {
  return jiti(path.join(root, "src/lib/files/fallbackUrl.ts")).toFilesFallbackUrl(src);
}

for (const [src, expected] of [
  ["https://files.hypertask.app/tasks/image.png", "/files/tasks/image.png"],
  ["https://files.hypertask.app/tasks/a%20b.png?width=400&token=a%2Fb", "/files/tasks/a%20b.png?width=400&token=a%2Fb"],
  ["https://files.hypertask.app/", "/files/"],
  ["https://files.hypertask.app/image.png#preview", "/files/image.png"],
  ["https://other.example/image.png", null],
  ["http://files.hypertask.app/image.png", null],
  ["https://other.files.hypertask.app/image.png", null],
  ["https://files.hypertask.app.evil.example/image.png", null],
  ["https://files.hypertask.app:8443/image.png", null],
  ["/files/image.png", null],
  ["//files.hypertask.app/image.png", null],
  ["data:image/png;base64,abc", null],
  ["not a URL", null],
  ["", null],
]) {
  test(`URL mapping: ${src || "empty"}`, () => {
    assert.equal(fallbackUrl(src), expected);
  });
}

test("proxy integration: rewrite, cache header, auth bypass and CSP", async () => {
  const config = require(path.join(root, "next.config.js"));
  assert.deepEqual((await config.rewrites()).find((rule) => rule.source === "/files/:path*"), {
    source: "/files/:path*",
    destination: "https://files.hypertask.app/:path*",
  });
  const headers = await config.headers();
  assert.ok(headers.find((rule) => rule.source === "/files/:path*").headers.some(
    (header) => header.key === "Cache-Control" && header.value === "public, max-age=31536000, immutable",
  ));
  for (const rule of headers) {
    for (const header of rule.headers) {
      if (header.key.toLowerCase() !== "content-security-policy") continue;
      const imgSrc = header.value.match(/(?:^|;)\s*img-src\s+([^;]+)/);
      if (imgSrc) assert.ok(imgSrc[1].split(/\s+/).includes("'self'"));
    }
  }

  const source = ts.createSourceFile("proxy.ts", fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((item) => item.name.getText(source) === "config");
  assert.ok(declaration?.initializer);
  const proxyConfig = vm.runInNewContext(`(${declaration.initializer.getText(source)})`);
  for (const url of ["/files/image.png", "/files/tasks/extensionless", "/files/", "/files"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig: config, url }), false, url);
  }
  for (const url of ["/project", "/files-private", "/api/mcp/tasks"]) {
    assert.equal(unstable_doesMiddlewareMatch({ config: proxyConfig, nextConfig: config, url }), true, url);
  }
});

test("router mounting: one root instance; Pages Router has only APIs", () => {
  const layout = fs.readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
  assert.equal((layout.match(/<FilesImageFallback\s*\/>/g) || []).length, 1);
  assert.match(layout, /import FilesImageFallback from "@\/components\/FilesImageFallback"/);
  assert.deepEqual(fs.readdirSync(path.join(root, "src/pages")), ["api"]);
  assert.equal(fs.existsSync(path.join(root, "pages")), false);
});

test("image listener: captures errors, retries once, ignores other images, and removes listener", async () => {
  const dom = new JSDOM("<!doctype html><div id='root'></div>", { url: "https://app.hypertask.ai" });
  const previous = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLImageElement: dom.window.HTMLImageElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const registrations = [];
  const removals = [];
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  document.addEventListener = (...args) => { registrations.push(args); return add(...args); };
  document.removeEventListener = (...args) => { removals.push(args); return remove(...args); };
  let reactRoot;
  try {
    const FilesImageFallback = jiti(path.join(root, "src/components/FilesImageFallback.tsx")).default;
    reactRoot = createRoot(document.getElementById("root"));
    await React.act(async () => reactRoot.render(React.createElement(FilesImageFallback)));
    const listeners = registrations.filter(([event]) => event === "error");
    assert.equal(listeners.length, 1);
    assert.equal(listeners[0][2], true);
    const image = document.createElement("img");
    image.src = "https://files.hypertask.app/tasks/image.png?token=abc";
    image.srcset = "https://files.hypertask.app/tasks/image.png?token=abc 1x, https://files.hypertask.app/tasks/image@2x.png 2x";
    document.body.append(image);
    assert.equal(image.getAttribute("src"), "https://files.hypertask.app/tasks/image.png?token=abc");
    image.dispatchEvent(new dom.window.Event("load"));
    assert.equal(image.hasAttribute("data-files-fallback"), false);
    image.dispatchEvent(new dom.window.Event("error"));
    assert.equal(image.getAttribute("src"), "/files/tasks/image.png?token=abc");
    assert.equal(image.getAttribute("data-files-fallback"), "1");
    assert.equal(image.srcset, "");
    image.dispatchEvent(new dom.window.Event("error"));
    assert.equal(image.getAttribute("src"), "/files/tasks/image.png?token=abc");
    image.src = "https://files.hypertask.app/tasks/another.png";
    image.dispatchEvent(new dom.window.Event("error"));
    assert.equal(image.getAttribute("src"), "https://files.hypertask.app/tasks/another.png");

    const responsive = document.createElement("img");
    responsive.src = "https://other.example/default.png";
    responsive.srcset = "https://files.hypertask.app/selected.png 2x";
    Object.defineProperty(responsive, "currentSrc", { value: "https://files.hypertask.app/selected.png" });
    document.body.append(responsive);
    responsive.dispatchEvent(new dom.window.Event("error"));
    assert.equal(responsive.getAttribute("src"), "/files/selected.png");
    assert.equal(responsive.srcset, "");

    for (const src of ["https://other.example/image.png", "http://files.hypertask.app/image.png", "/files/image.png"]) {
      const other = document.createElement("img");
      other.src = src;
      document.body.append(other);
      other.dispatchEvent(new dom.window.Event("error"));
      assert.equal(other.getAttribute("src"), src);
      assert.equal(other.hasAttribute("data-files-fallback"), false);
    }
    const div = document.createElement("div");
    document.body.append(div);
    div.dispatchEvent(new dom.window.Event("error"));
    assert.equal(div.hasAttribute("data-files-fallback"), false);

    await React.act(async () => reactRoot.render(React.createElement(FilesImageFallback)));
    assert.equal(registrations.filter(([event]) => event === "error").length, 1);
    await React.act(async () => reactRoot.unmount());
    reactRoot = null;
    assert.deepEqual(removals.filter(([event]) => event === "error"), listeners);
    const afterUnmount = document.createElement("img");
    afterUnmount.src = "https://files.hypertask.app/after.png";
    document.body.append(afterUnmount);
    afterUnmount.dispatchEvent(new dom.window.Event("error"));
    assert.equal(afterUnmount.getAttribute("src"), "https://files.hypertask.app/after.png");
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
