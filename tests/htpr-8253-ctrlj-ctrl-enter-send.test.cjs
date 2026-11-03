const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const flag = "htpr-8253-ctrlj-ctrl-enter-send";
const fixturePath = path.join(__dirname, "compose-task-palette.test.cjs");
const fixtureSource = fs.readFileSync(fixturePath, "utf8");
const fixture = new Module(fixturePath, module);
fixture.filename = fixturePath;
fixture.paths = module.paths;
fixture._compile(`${fixtureSource.slice(0, fixtureSource.indexOf("\ntest("))}\nmodule.exports = { withPalette };`, fixturePath);
const { withPalette } = fixture.exports;
const writer = () => document.querySelector("[data-compose-task-writer]");
const footer = () => [...writer().children].find((node) => node.classList.contains("border-t"));

test("flag registers a default-Everyone low-risk improvement", () => {
  const jiti = createJiti(__filename, { fsCache: false });
  const definition = jiti(path.join(root, `src/lib/flags/definitions/${flag}.ts`));
  assert.equal(definition.HTPR_8253_CTRLJ_CTRL_ENTER_SEND_FLAG, flag);
  assert.equal(definition.default.key, flag);
  assert.equal(definition.default.kind, "improvement");
  assert.equal(definition.default.defaultMode, "EVERYONE");
  assert.equal(definition.default.releaseRisk.risk, "small");
  assert.ok(definition.default.releaseRisk.reason);
  assert.equal(definition.default.releaseRisk.highRisk, undefined);
});

test("Enter starts a new paragraph and Ctrl+Enter creates the ticket once in the shipped mode", async (t) => {
  await withPalette(t, { tab: "compose", url: "/project?id=7" }, async ({ input, type, press, requests, flags, rerender }) => {
    flags[flag] = true;
    await rerender();
    assert.match(footer().textContent, /Ctrl Enter Send/);
    await type("First paragraph");
    const enter = await press("Enter", { code: "Enter" }, input());
    assert.equal(enter.defaultPrevented, false, "plain Enter must reach the textarea so it starts a new line");
    assert.equal(requests.length, 0, "plain Enter must not create a ticket");
    await type("First paragraph\n\nSecond paragraph");
    const again = await press("Enter", { code: "Enter", shiftKey: true }, input());
    assert.equal(again.defaultPrevented, false, "Shift+Enter keeps starting a new line");
    assert.equal(requests.length, 0);
    await press("Enter", { code: "Enter", ctrlKey: true }, input());
    assert.equal(requests.length, 1, "Ctrl+Enter creates exactly one ticket");
    assert.equal(requests[0].body.text, "First paragraph\n\nSecond paragraph");
  });
});

test("Cmd+Enter sends on a Mac and the footer hint names the platform shortcut", async (t) => {
  await withPalette(t, { tab: "compose", url: "/project?id=7", apple: true }, async ({ input, type, press, requests, flags, rerender }) => {
    flags[flag] = true;
    await rerender();
    assert.match(footer().textContent, /Cmd Enter Send/);
    await type("A Mac note");
    const enter = await press("Enter", { code: "Enter" }, input());
    assert.equal(enter.defaultPrevented, false);
    assert.equal(requests.length, 0);
    await press("Enter", { code: "Enter", metaKey: true }, input());
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.text, "A Mac note");
  });
});

test("flag off keeps Enter as the send shortcut and the old hint", async (t) => {
  await withPalette(t, { tab: "compose", url: "/project?id=7" }, async ({ input, type, press, requests, flags, rerender }) => {
    flags[flag] = false;
    await rerender();
    assert.doesNotMatch(footer().textContent, /Ctrl Enter/);
    assert.match(footer().textContent, /Enter Send/);
    await type("Old Enter note");
    await press("Enter", { code: "Enter" }, input());
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.text, "Old Enter note");
  });
});

test("the Ctrl+J key footer names the new create and new-line keys", async (t) => {
  for (const apple of [false, true]) {
    await withPalette(t, { tab: "compose", apple, boards: [{ id: 7, title: "QA Sandbox", uniqueIdentifier: "QASA" }], url: "/my-tasks", previousBoard: "project-7" }, async ({ flags, rerender }) => {
      flags["htpr-8260-ctrlj-composer-keys"] = true;
      flags[flag] = true;
      await rerender();
      const commandKey = apple ? "Cmd" : "Ctrl";
      assert.deepEqual([...footer().querySelectorAll("span")].map((span) => span.textContent.replace(/\s+/g, " ").trim()).slice(0, 3),
        [`${commandKey} Enter create`, "Enter new line", "Esc close"]);
      flags[flag] = false;
      await rerender();
      assert.deepEqual([...footer().querySelectorAll("span")].map((span) => span.textContent.replace(/\s+/g, " ").trim()).slice(0, 2),
        ["Enter create", "Shift Enter new line"]);
    });
  }
});
