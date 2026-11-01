const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const flag = "htpr-7306-ctrlj-footer-one-line";
const { withPalette } = require('./helpers/compose-task-palette-fixture.cjs');
const writer = () => document.querySelector("[data-compose-task-writer]");

for (const apple of [false, true]) {
  test(`desktop ${apple ? "Mac" : "PC"}: flag on removes only Esc Close; flag off restores the exact footer`, async (t) => {
    await withPalette(t, { apple, newWindow: true, boardChip: true, tab: "compose", url: "/inbox" }, async ({ flags, rerender }) => {
      const original = writer().innerHTML;
      const expected = writer().cloneNode(true);
      const hint = [...expected.querySelectorAll("span")].find((span) => span.textContent === "Esc Close");
      assert.ok(hint, "flag off must retain the existing Esc Close hint");
      hint.remove();
      flags[flag] = true;
      await rerender();
      assert.doesNotMatch(writer().textContent, /Esc Close/);
      assert.equal(writer().innerHTML, expected.innerHTML, "all other footer markup must stay identical");
      flags[flag] = false;
      await rerender();
      assert.equal(writer().innerHTML, original);
    });
  });
}

for (const phoneSheet of [false, true]) {
  test(`phone layout is byte-identical with the phone sheet ${phoneSheet ? "on" : "off"}`, async (t) => {
    await withPalette(t, { mobile: true, newWindow: true, boardChip: true, tab: "compose" }, async ({ flags, rerender }) => {
      flags["htpr-6891-phone-task-writer-sheet"] = phoneSheet;
      await rerender();
      const original = document.getElementById("root").innerHTML;
      assert.equal(writer().textContent.includes("Esc Close"), !phoneSheet);
      flags[flag] = true;
      await rerender();
      assert.equal(document.getElementById("root").innerHTML, original);
    });
  });
}

test("legacy Compose keeps its Esc Close hint and markup", async (t) => {
  await withPalette(t, { tab: "compose", newWindow: false }, async ({ flags, rerender }) => {
    const original = writer().innerHTML;
    assert.match(writer().textContent, /Esc Close/);
    flags[flag] = true;
    await rerender();
    assert.equal(writer().innerHTML, original);
  });
});

for (const enabled of [false, true]) {
  test(`Escape still closes New Task with the footer flag ${enabled ? "on" : "off"}`, async (t) => {
    await withPalette(t, { newWindow: true, tab: "compose" }, async ({ flags, rerender, press, values, input }) => {
      flags[flag] = enabled;
      await rerender();
      assert.equal(document.activeElement, input());
      assert.equal(values.get("showCommandsAtom").show, true);
      const event = await press("Escape", { code: "Escape" });
      assert.equal(event.defaultPrevented, true);
      assert.equal(values.get("showCommandsAtom").show, false);
      assert.equal(writer(), null);
    });
  });
}

test("feature flag ships for Everyone with a small release risk", () => {
  const jiti = createJiti(__filename, { fsCache: false });
  const definition = jiti(path.join(root, `src/lib/flags/definitions/${flag}.ts`));
  assert.equal(definition.HTPR_7306_CTRLJ_FOOTER_ONE_LINE_FLAG, flag);
  assert.equal(definition.default.key, flag);
  assert.equal(definition.default.kind, "feature");
  assert.equal(definition.default.defaultMode, "EVERYONE");
  assert.equal(definition.default.releaseRisk.risk, "small");
  assert.ok(definition.default.releaseRisk.reason);
});
