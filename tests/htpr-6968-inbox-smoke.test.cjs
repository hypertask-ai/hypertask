const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { expect } = require("@playwright/test");
const { load } = require("./task-route-loader.cjs");

function inboxCheck() {
  const checks = new Map();
  const register = (name, ...args) => checks.set(name, args.at(-1));
  register.afterEach = () => {};
  register.skip = condition => assert.equal(condition, false);
  const filename = path.resolve("e2e/smoke/prod.spec.ts");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports: {}, __dirname: path.dirname(filename), process: { env: {} },
    require: specifier => {
      if (specifier === "@playwright/test") return { test: register, expect };
      if (specifier.startsWith("./lib/")) return load(`e2e/smoke/${specifier.slice(2)}.ts`, {});
      return require(specifier);
    },
  }, { filename });
  assert.ok(checks.has("inbox loads"));
  return checks.get("inbox loads");
}

// Exercise the real smoke callback and Playwright matchers without requiring
// Chromium in the unit-test job. Only the browser protocol boundary is doubled.
class Locator {
  _apiName = "Locator";
  first() { return this; }
  async innerText() { return "Inbox notifications have loaded successfully."; }
  async _expect(expression) {
    assert.ok(["to.have.count", "to.be.attached"].includes(expression));
    return { matches: true, received: expression === "to.have.count" ? 0 : undefined };
  }
}
class Page {
  constructor(settledTitle) {
    this._apiName = "Page";
    this.currentTitle = "";
    this.settledTitle = settledTitle;
    this.titleChecks = [];
  }
  on() {}
  async goto() { return { status: () => 200, headers: () => ({}) }; }
  url() { return "http://inbox-smoke.invalid/inbox?realtime=on"; }
  locator() { return new Locator(); }
  async title() { return this.currentTitle; }
  mainFrame() { return this; }
  async _expect(expression, options) {
    assert.equal(expression, "to.have.title");
    assert.equal(options.timeout, 15_000, "metadata readiness must have a bounded deadline");
    assert.equal(options.isNot, false);
    assert.equal(options.expectedText[0].regexSource, "^Inbox");
    this.titleChecks.push(expression);
    await Promise.resolve();
    this.currentTitle = this.settledTitle;
    const matches = new RegExp(options.expectedText[0].regexSource).test(this.currentTitle);
    return { matches, received: { value: this.currentTitle }, timedOut: !matches, log: [] };
  }
}

test("inbox smoke waits for metadata after the content-ready marker", async () => {
  const page = new Page("Inbox");
  assert.equal(await page.title(), "", "the initial title must expose the readiness race");
  await inboxCheck()({ page }, {});
  assert.equal(await page.title(), "Inbox");
  assert.deepEqual(page.titleChecks, ["to.have.title"]);
});

for (const title of ["", "Wrong route"]) {
  test(`inbox smoke still rejects a persistent ${title ? "wrong" : "missing"} title`, async () => {
    const page = new Page(title);
    await assert.rejects(() => inboxCheck()({ page }, {}), /toHaveTitle/);
    assert.deepEqual(page.titleChecks, ["to.have.title"]);
  });
}
