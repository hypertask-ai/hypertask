const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");
const React = require("react");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7675-ctrlj-enter-before-text-renders";
const fixturePath = path.join(__dirname, "compose-task-palette.test.cjs");
const fixtureSource = fs.readFileSync(fixturePath, "utf8");
const fixture = new Module(fixturePath, module);
fixture.filename = fixturePath;
fixture.paths = module.paths;
fixture._compile(`${fixtureSource.slice(0, fixtureSource.indexOf("\ntest("))}\nmodule.exports = { withPalette };`, fixturePath);
const { withPalette } = fixture.exports;

async function withComposer(t, holdEnabled, check) {
  await withPalette(t, { newWindow: true, boardChip: false, tab: "compose", url: "/project?id=7" }, async (palette) => {
    palette.flags[flag] = holdEnabled;
    await palette.rerender();
    const typeKeysBeforeRender = (...keys) => React.act(async () => {
      const field = palette.input();
      const rendered = field[Object.keys(field).find((key) => key.startsWith("__reactProps$"))];
      for (const key of keys) {
        if (key === "Enter") rendered.onKeyDown({ key, shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} });
        else rendered.onChange({ target: { value: key } });
      }
    });
    await check({ ...palette, typeKeysBeforeRender });
  });
}

test("Enter pressed before the typed note renders creates the ticket once with that note", async (t) => {
  await withComposer(t, true, async ({ typeKeysBeforeRender, requests }) => {
    await typeKeysBeforeRender("Improve search", "Enter");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.text, "Improve search");
  });
});

test("two Enters before the note renders still send only once", async (t) => {
  await withComposer(t, true, async ({ typeKeysBeforeRender, requests }) => {
    await typeKeysBeforeRender("Improve search", "Enter", "Enter");
    assert.equal(requests.length, 1);
  });
});

test("typing after an early Enter cancels it until Enter is pressed again", async (t) => {
  await withComposer(t, true, async ({ typeKeysBeforeRender, press, requests }) => {
    await typeKeysBeforeRender("Improve search", "Enter", "Improve search and filters");
    assert.equal(requests.length, 0);
    await press("Enter", { code: "Enter" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.text, "Improve search and filters");
  });
});

test("still allowed: Enter after the note has rendered sends it once, as before", async (t) => {
  await withComposer(t, true, async ({ type, press, requests }) => {
    await type("Improve search");
    await press("Enter", { code: "Enter" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.text, "Improve search");
  });
});

test("still refused: Enter on an empty box sends nothing", async (t) => {
  await withComposer(t, true, async ({ typeKeysBeforeRender, press, requests }) => {
    await typeKeysBeforeRender("   ", "Enter");
    await press("Enter", { code: "Enter" });
    assert.equal(requests.length, 0);
  });
});

test("flag off keeps the old behaviour where the early Enter does nothing", async (t) => {
  await withComposer(t, false, async ({ typeKeysBeforeRender, press, requests }) => {
    await typeKeysBeforeRender("Improve search", "Enter");
    assert.equal(requests.length, 0);
    await press("Enter", { code: "Enter" });
    assert.equal(requests.length, 1);
  });
});

test("bugfix flag defaults to Everyone", () => {
  const definition = loadModule(`src/lib/flags/definitions/${flag}.ts`).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "bugfix");
  assert.equal(definition.defaultMode, "EVERYONE");
});
