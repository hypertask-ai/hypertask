const assert = require("node:assert/strict");
const test = require("node:test");

let mod;
test.before(async () => {
  mod = await import("../src/lib/tickets/plainLanguageTicket.mjs");
});

const valid = () =>
  mod.renderPlainLanguageTicketDescription({
    whatWrongOrWanted: "Inbox E does not archive blocked-by-me tickets.",
    whoItAffects: "desktop and phone Inbox users",
    recommendedCourseAndWhy: "Archive on E like other tickets. Why: the blocker marker already explains the wait.",
    whatValentinMustDecide: "nothing",
    howToUndo: "revert the PR",
  });

test("valid block passes", () => {
  const html = valid();
  assert.equal(mod.hasPlainLanguageTicketBlock(html), true);
  assert.deepEqual(mod.missingPlainLanguageTicketLabels(html), []);
});

test("missing recommendation label fails", () => {
  const broken = valid().replace(/Recommended course and why/i, "Next step");
  assert.equal(mod.hasPlainLanguageTicketBlock(broken), false);
  assert.ok(mod.missingPlainLanguageTicketLabels(broken).includes("Recommended course and why"));
});

test("labels must open the description", () => {
  const late = `<p>intro</p>${valid()}`;
  assert.equal(mod.hasPlainLanguageTicketBlock(late), false);
});

test("render output validates as a block", () => {
  assert.equal(mod.hasPlainLanguageTicketBlock(valid()), true);
});
