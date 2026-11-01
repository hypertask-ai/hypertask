const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const React = require("react");
const { notifyManager, defaultScheduler } = require("@tanstack/react-query");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7305-board-from-text";
const jiti = createJiti(__filename, { fsCache: false });
const { matchComposeTaskBoard } = jiti(path.join(root, "src/lib/ai/composeTaskBoard.ts"));
const boards = [
  { id: 7, title: "QA Sandbox", uniqueIdentifier: "QASA" },
  { id: 8, title: "Hypertask Product", uniqueIdentifier: "HTPR" },
  { id: 9, title: "Design", uniqueIdentifier: "DES" },
];
const { withPalette } = require('./helpers/compose-task-palette-fixture.cjs');
const chip = () => document.querySelector("[data-compose-board-chip]");

for (const [note, expected] of [
  ["Add keyboard help for the project hypertask product", 8],
  ["Create a task on board QA Sandbox", 7],
  ["Improve search in Hypertask Product", 8],
  ["Create a task for htpr", 8],
  ["In ‘HYpertask Product’, improve search", 8],
  ["Improve search in Hypertask\nProduct", 8],
  ["Move it to the board QA Sandbox", 7],
]) {
  test(`unique board match: ${JSON.stringify(note)}`, () => {
    assert.equal(matchComposeTaskBoard(note, boards), expected);
  });
}

for (const note of ["HTPR: improve search", "Hypertask Product (HTPR): improve search", "Rename QA Sandbox fixtures", "Fix the Hypertask Product logo"]) {
  test(`a board name without for, on, in or to does not move the task: ${JSON.stringify(note)}`, () => {
    assert.equal(matchComposeTaskBoard(note, boards), undefined);
  });
}

for (const [note, expected] of []) {
  test(`unique board match: ${JSON.stringify(note)}`, () => {
    assert.equal(matchComposeTaskBoard(note, boards), expected);
  });
}

test("no match, inaccessible boards, partial names and ambiguous names never guess", () => {
  for (const note of ["Improve search", "Use Unavailable Board", "Improve Hypertask", "XHTPR", "HTPR2", "HTPR_suffix", "préHTPR", "HTPR東京"]) {
    assert.equal(matchComposeTaskBoard(note, boards), undefined, note);
  }
  assert.equal(matchComposeTaskBoard("in Hypertask Product", [boards[0]]), undefined);
  assert.equal(matchComposeTaskBoard("on board QA Sandbox", []), undefined);
  assert.equal(matchComposeTaskBoard("in Hypertask Product and on board QA Sandbox", boards), undefined);
  assert.equal(matchComposeTaskBoard("in Hypertask Product", [...boards, { id: 10, title: "Hypertask Product" }]), undefined);
  assert.equal(matchComposeTaskBoard("in HTPR", [...boards, { id: 10, title: "Other", uniqueIdentifier: "HTPR" }]), undefined);
  assert.equal(matchComposeTaskBoard("in Hypertask Product", [...boards, { id: 10, title: "Product" }]), undefined);
});

test("board names are literal, blank aliases are ignored and repeated mentions count once", () => {
  const literal = [{ id: 12, title: "C++ [Web]", uniqueIdentifier: "" }, { id: 13, title: "", uniqueIdentifier: "  " }];
  assert.equal(matchComposeTaskBoard("in C++ [Web]: add shortcuts", literal), 12);
  assert.equal(matchComposeTaskBoard("in C [Web]", literal), undefined);
  assert.equal(matchComposeTaskBoard("No named board", literal), undefined);
  assert.equal(matchComposeTaskBoard("in Hypertask Product, for HTPR, in Hypertask Product", boards), 8);
});

for (const mobile of [false, true]) {
  test(`text match updates the existing ${mobile ? "phone" : "desktop"} chip before saving on its displayed board`, async (t) => {
    await withPalette(t, { mobile, newWindow: true, boardChip: true, tab: "compose", boards, url: "/project?id=7" }, async ({ flags, rerender, type, press, requests, input }) => {
      flags[flag] = true;
      await rerender();
      const note = "Improve search for the project hypertask product";
      await type(note);
      assert.equal(chip().textContent, "Hypertask Product");
      assert.equal(input().value, note);
      assert.equal(requests.length, 0);
      await press("Enter", { code: "Enter" });
      assert.equal(requests[0].body.project.id, 8);
      assert.equal(requests[0].body.viewProject, undefined);
      assert.equal(requests[0].body.text, note);
    });
  });
}

test("a manual chip choice after a text match wins, including after more typing", async (t) => {
  await withPalette(t, { newWindow: true, boardChip: true, tab: "compose", boards, url: "/inbox", previousBoard: "project-7" }, async ({ flags, rerender, type, press, requests }) => {
    flags[flag] = true;
    await rerender();
    await type("Improve search in Hypertask Product");
    assert.equal(chip().textContent, "Hypertask Product");
    await React.act(async () => chip().click());
    assert.ok(document.querySelector('input[id="input-addTask"]'));
    await press("ArrowDown", { code: "ArrowDown" });
    await press("ArrowDown", { code: "ArrowDown" });
    await press("Enter", { code: "Enter" });
    assert.equal(chip().textContent, "Design");
    assert.equal(requests.length, 0);
    await type("Improve search in Hypertask Product and add help");
    assert.equal(chip().textContent, "Design");
    await press("Enter", { code: "Enter" });
    assert.equal(requests[0].body.project.id, 9);
  });
});

for (const boardChip of [false, true]) {
  test(`flag off retains the old destination and input with the board chip ${boardChip ? "on" : "off"}`, async (t) => {
    await withPalette(t, { newWindow: true, boardChip, tab: "compose", boards, url: "/inbox", previousBoard: "project-7" }, async ({ type, press, requests, input }) => {
      const note = "Improve search in Hypertask Product";
      await type(note);
      assert.equal(chip()?.textContent ?? null, boardChip ? "QA Sandbox" : null);
      assert.equal(input().value, note);
      await press("Enter", { code: "Enter" });
      assert.equal(requests[0].body.project.id, 7);
      assert.equal(requests[0].body.text, note);
    });
  });

  test(`text routing still works when the board chip is ${boardChip ? "shown" : "disabled"}`, async (t) => {
    await withPalette(t, { newWindow: true, boardChip, tab: "compose", boards, url: "/detail/project-7/42", inView: { taskId: 42, taskProjectId: 7 }, targetTask: { id: 42, projectId: 7, uniqueIndex: 42, title: "", description_: { content: "" } } }, async ({ flags, rerender, type, press, requests }) => {
      flags[flag] = true;
      await rerender();
      await type("Improve search in HTPR");
      assert.equal(chip()?.textContent ?? null, boardChip ? "Hypertask Product" : null);
      await press("Enter", { code: "Enter" });
      assert.equal(requests[0].body.project.id, 8);
      assert.equal(requests[0].body.existingTaskId, undefined, "never fill an empty ticket on the old board");
    });
  });
}

for (const [url, expected] of [["/project?id=7", 7], ["/inbox", 9]]) {
  for (const note of ["Improve search", "Improve in Hypertask Product and on board QA Sandbox"]) {
    test(`no unique text match preserves destination ${expected} from ${url}: ${note}`, async (t) => {
      await withPalette(t, { newWindow: true, boardChip: true, tab: "compose", boards, url, previousBoard: "project-9" }, async ({ flags, rerender, type, press, requests }) => {
        flags[flag] = true;
        await rerender();
        await type(note);
        await press("Enter", { code: "Enter" });
        assert.equal(requests[0].body.project.id, expected);
        assert.equal(requests[0].body.viewProject?.id, expected === 7 ? 7 : undefined);
      });
    });
  }
}

test("removing a match or adding a second board restores the contextual board before saving", async (t) => {
  await withPalette(t, { newWindow: true, boardChip: true, tab: "compose", boards, url: "/inbox", previousBoard: "project-7" }, async ({ flags, rerender, type }) => {
    flags[flag] = true;
    await rerender();
    await type("Improve search in Hypertask Product");
    assert.equal(chip().textContent, "Hypertask Product");
    await type("Improve search in Hypertask Product and on board Design");
    assert.equal(chip().textContent, "QA Sandbox");
    await type("Improve search");
    assert.equal(chip().textContent, "QA Sandbox");
    flags[flag] = false;
    await type("Improve search in Hypertask Product");
    assert.equal(chip().textContent, "QA Sandbox");
  });
});

test("a cold board list cannot race Enter or Send and save on the old board", async (t) => {
  notifyManager.setScheduler(queueMicrotask);
  t.after(() => notifyManager.setScheduler(defaultScheduler));
  await withPalette(t, { newWindow: true, boardChip: false, tab: "compose", url: "/project?id=7" }, async ({ flags, rerender, type, press, requests }) => {
    let resolveBoards;
    const api = require.cache[path.join(root, "src/utils/api/global/index.ts")].exports.default;
    api.getAllProjectsMinimal = () => new Promise((resolve) => { resolveBoards = resolve; });
    flags[flag] = true;
    await rerender();
    await type("Improve search in Hypertask Product");
    assert.equal(document.querySelector('[aria-label="Send message"]').disabled, true);
    await press("Enter", { code: "Enter" });
    assert.equal(requests.length, 0);
    api.getAllProjectsMinimal = async () => boards;
    await React.act(async () => {
      resolveBoards(boards);
    });
    assert.equal(document.querySelector('[aria-label="Send message"]').disabled, false);
    await press("Enter", { code: "Enter" });
    assert.equal(requests[0].body.project.id, 8);
  });
});

test("feature flag ships for Everyone with small release risk", () => {
  const definition = jiti(path.join(root, `src/lib/flags/definitions/${flag}.ts`));
  assert.equal(definition.HTPR_7305_BOARD_FROM_TEXT_FLAG, flag);
  assert.equal(definition.default.key, flag);
  assert.equal(definition.default.kind, "feature");
  assert.equal(definition.default.defaultMode, "EVERYONE");
  assert.equal(definition.default.releaseRisk.risk, "small");
  assert.ok(definition.default.releaseRisk.reason);
});
