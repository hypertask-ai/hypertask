const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { test } = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");
const React = require("react");
const { notifyManager, defaultScheduler } = require("@tanstack/react-query");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7652-ctrlj-enter-queue";
const boardFromTextFlag = "htpr-7305-board-from-text";
const boards = [
  { id: 7, title: "QA Sandbox", uniqueIdentifier: "QASA" },
  { id: 8, title: "Hypertask Product", uniqueIdentifier: "HTPR" },
];
const fixturePath = path.join(__dirname, "compose-task-palette.test.cjs");
const fixtureSource = fs.readFileSync(fixturePath, "utf8");
const fixture = new Module(fixturePath, module);
fixture.filename = fixturePath;
fixture.paths = module.paths;
fixture._compile(`${fixtureSource.slice(0, fixtureSource.indexOf("\ntest("))}\nmodule.exports = { withPalette };`, fixturePath);
const { withPalette } = fixture.exports;

async function withColdBoards(t, queueEnabled, check) {
  notifyManager.setScheduler(queueMicrotask);
  t.after(() => notifyManager.setScheduler(defaultScheduler));
  await withPalette(t, { newWindow: true, boardChip: false, tab: "compose", url: "/project?id=7" }, async (palette) => {
    let resolveBoards;
    const api = require.cache[path.join(root, "src/utils/api/global/index.ts")].exports.default;
    api.getAllProjectsMinimal = () => new Promise((resolve) => { resolveBoards = resolve; });
    palette.flags[boardFromTextFlag] = true;
    palette.flags[flag] = queueEnabled;
    await palette.rerender();
    const boardsArrive = async () => {
      api.getAllProjectsMinimal = async () => boards;
      await React.act(async () => {
        resolveBoards(boards);
      });
    };
    await check({ ...palette, boardsArrive });
  });
}

test("Enter pressed before the board list loads creates the ticket once when it arrives", async (t) => {
  await withColdBoards(t, true, async ({ type, press, requests, boardsArrive }) => {
    await type("Improve search in Hypertask Product");
    await press("Enter", { code: "Enter" });
    assert.equal(requests.length, 0, "nothing is sent before the board list is known");
    await boardsArrive();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.project.id, 8);
    assert.equal(requests[0].body.text, "Improve search in Hypertask Product");
  });
});

test("Enter pressed twice while boards load still sends only once", async (t) => {
  await withColdBoards(t, true, async ({ type, press, requests, boardsArrive }) => {
    await type("Improve search");
    await press("Enter", { code: "Enter" });
    await press("Enter", { code: "Enter" });
    await boardsArrive();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.project.id, 7);
  });
});

test("typing after Enter cancels the queued send until Enter is pressed again", async (t) => {
  await withColdBoards(t, true, async ({ type, press, requests, boardsArrive }) => {
    await type("Improve search");
    await press("Enter", { code: "Enter" });
    await type("Improve search and filters");
    await boardsArrive();
    assert.equal(requests.length, 0);
    await press("Enter", { code: "Enter" });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.text, "Improve search and filters");
  });
});

test("switching the fix or board-from-text off while Enter is held cancels the send", async (t) => {
  for (const key of [flag, boardFromTextFlag]) {
    await withColdBoards(t, true, async ({ flags, rerender, type, press, requests, boardsArrive }) => {
      await type("Improve search");
      await press("Enter", { code: "Enter" });
      flags[key] = false;
      await rerender();
      await boardsArrive();
      assert.equal(requests.length, 0, key);
    });
  }
});

test("switching the fix off and on again while Enter is held does not revive the send", async (t) => {
  await withColdBoards(t, true, async ({ flags, rerender, type, press, requests, boardsArrive }) => {
    await type("Improve search");
    await press("Enter", { code: "Enter" });
    flags[flag] = false;
    await rerender();
    flags[flag] = true;
    await rerender();
    await boardsArrive();
    assert.equal(requests.length, 0);
  });
});

test("flag off keeps the old behaviour where Enter during the board load does nothing", async (t) => {
  await withColdBoards(t, false, async ({ type, press, requests, boardsArrive }) => {
    await type("Improve search");
    await press("Enter", { code: "Enter" });
    await boardsArrive();
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
