const assert = require("node:assert/strict");
const test = require("node:test");
const { withPalette } = require('./helpers/compose-task-palette-fixture.cjs');
const writer = () => document.querySelector("[data-compose-task-writer]");

for (const apple of [false, true]) {
  test(`desktop ${apple ? "Mac" : "PC"}: New Task permanently hides Esc Close and Escape still closes`, async (t) => {
    await withPalette(t, { apple, tab: "compose", url: "/inbox" }, async ({ press, values, input }) => {
      assert.doesNotMatch(writer().textContent, /Esc Close/);
      for (const hint of ["Send", "Attach files", "Search", "Board"]) assert.ok(writer().textContent.includes(hint), hint);
      assert.equal(document.activeElement, input());
      assert.equal(values.get("showCommandsAtom").show, true);
      const event = await press("Escape", { code: "Escape" });
      assert.equal(event.defaultPrevented, true);
      assert.equal(values.get("showCommandsAtom").show, false);
      assert.equal(writer(), null);
    });
  });
}

test("phone New Task sheet still hides the footer", async (t) => {
  await withPalette(t, { mobile: true, tab: "compose" }, async () => {
    assert.equal(writer().textContent.includes("Esc Close"), false);
    assert.equal([...writer().children].some(node => node.classList.contains("border-t")), false);
  });
});
