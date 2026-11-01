const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const React = require("react");

const flag = "htpr-7656-ctrlj-skill-menu";
const invokeSkillsFlag = "htpr-7312-ctrlj-skills";
const menuId = "ht-taskwriter-skill-menu";
const skills = [
  { slug: "deeper", name: "deeper", description: "Turn a task into a deeper version, not a bigger one.", enabled: true, projectId: null },
  { slug: "unslop", name: "unslop", description: "Cut AI tells from any writing.", enabled: true, projectId: null },
];
const { withPalette } = require('./helpers/compose-task-palette-fixture.cjs');

async function withSkillMenu(t, { menuFlag = true, invokeSkills = true, newWindow = false } = {}, check) {
  await withPalette(t, { tab: "compose", newWindow }, async (palette) => {
    const skillRequests = [];
    const previousGetComputedStyle = global.getComputedStyle;
    global.getComputedStyle = palette.dom.window.getComputedStyle.bind(palette.dom.window);
    t.after(() => { global.getComputedStyle = previousGetComputedStyle; });
    global.fetch = async (url) => {
      skillRequests.push(String(url));
      return { ok: true, status: 200, json: async () => ({ skills }) };
    };
    palette.flags[flag] = menuFlag;
    palette.flags[invokeSkillsFlag] = invokeSkills;
    await palette.rerender();
    const typeAndWait = async (value) => {
      await palette.type(value);
      await React.act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    };
    await check({ ...palette, typeAndWait, skillRequests, menu: () => document.getElementById(menuId) });
  });
}

test("typing / in Ctrl+J shows the skill picker with the matching skill", async (t) => {
  await withSkillMenu(t, {}, async ({ typeAndWait, menu }) => {
    await typeAndWait("Improve search /dee");
    assert.ok(menu(), "the skill picker opens after a / token");
    assert.match(menu().textContent, /SKILL\/deeper/);
    assert.doesNotMatch(menu().textContent, /unslop/, "the list filters to what was typed");
  });
});

test("Enter on the picker inserts the skill and does not create the ticket", async (t) => {
  await withSkillMenu(t, {}, async ({ typeAndWait, press, input, menu, requests }) => {
    await typeAndWait("Improve search /dee");
    await press("Enter", { code: "Enter" });
    assert.equal(input().value, "Improve search /deeper ");
    assert.equal(menu(), null, "the picker closes after a pick");
    assert.equal(requests.length, 0, "picking a skill never sends the ticket");
  });
});

test("Enter that confirms an IME composition is left to the input method", async (t) => {
  await withSkillMenu(t, {}, async ({ typeAndWait, press, input, requests }) => {
    await typeAndWait("Improve search /dee");
    await press("Enter", { code: "Enter", isComposing: true });
    assert.equal(input().value, "Improve search /dee", "the picker does not replace text mid-composition");
    assert.equal(requests.length, 0);
  });
});

test("Escape closes only the picker and keeps Ctrl+J open with the draft", async (t) => {
  await withSkillMenu(t, {}, async ({ typeAndWait, press, input, menu, values }) => {
    await typeAndWait("Draft /dee");
    await press("Escape", { code: "Escape" });
    assert.equal(menu(), null);
    assert.equal(values.get("showCommandsAtom").show, true, "Ctrl+J stays open");
    assert.equal(input().value, "Draft /dee");
  });
});

test("Tab picks the skill instead of switching to Search in the New Task window", async (t) => {
  await withSkillMenu(t, { newWindow: true }, async ({ typeAndWait, press, input, values }) => {
    await typeAndWait("/dee");
    await press("Tab", { code: "Tab" });
    assert.equal(input().value, "/deeper ");
    assert.notEqual(values.get("showCommandsAtom").paletteTab, "search");
  });
});

test("still allowed: Enter without a / token creates the ticket as before", async (t) => {
  await withSkillMenu(t, {}, async ({ typeAndWait, press, menu, requests }) => {
    await typeAndWait("Improve search");
    assert.equal(menu(), null);
    await press("Enter", { code: "Enter" });
    assert.equal(requests.length, 1);
  });
});

for (const [name, options] of [["flag off", { menuFlag: false }], ["Ctrl+J skills off", { invokeSkills: false }]]) {
  test(`${name}: no skill picker and no skill lookup`, async (t) => {
    await withSkillMenu(t, options, async ({ typeAndWait, menu, skillRequests }) => {
      await typeAndWait("Improve search /dee");
      assert.equal(menu(), null);
      assert.equal(skillRequests.filter((url) => url.includes("skill")).length, 0);
    });
  });
}
