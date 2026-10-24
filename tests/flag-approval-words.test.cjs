const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename, { interopDefault: true });
const { normalizeVisibleText, classifyAnswer, parseSwitchQuestion, strictSwitchRequest, FLAG_CHAT_RECORD_AGENT_ID } = jiti(path.join(__dirname, "../src/lib/flags/approvalWords.ts"));

for (const [expected, fixtures] of [
  ["yes", ["Yes", "yes!", "YES.", "ship it", "works, release it", "Yes, ship it", "yes, ship it", "ok go ahead", "👍", "lgtm",
    "yep", "yeah", "yup", "okay", "approve", "approved", "go for it", "do it", "flip it", "switch it", "turn it on", "looks good",
    "@Valentin Yeo yes", "@HT Product Lead: ship it", "yes please thanks", "yes 100 perfect"]],
  ["no", ["No", "no.", "No this theme is horrible and needs a lot more work", "not yet", "don't", "nope",
    "nah", "dont", "never", "stop", "hold", "do not", "👎", "no?", "don’t"]],
  ["unclear", ["yes but not on phone", "yes?", "works for me?", "the release failed", "works only locally", "I wish we could ship",
    "if it works, release it", "maybe", "yes, later", "sure, wait", "", "hmm",
    "yes no", "yes not", "yes never", "yes don't", "yes dont", "yes do not", "yes can't", "yes cannot", "yes won't",
    "yes hold", "yes stop", "yes unless", "yes until", "yes perhaps", "yes except", "yes however", "yes instead",
    "yes broken", "yes bug", "yes 👎", "yes unknown", "<unknown>yes</unknown>", "sure", "works", 'Valentin said in chat (2026-10-24): "yes, ship it"']],
]) {
  for (const fixture of fixtures) {
    test(`classifyAnswer ${JSON.stringify(fixture)} is ${expected}`, () => {
      assert.equal(classifyAnswer(fixture), expected);
    });
  }
}

test("normalizeVisibleText extracts HTML text, NFKC, quotes, case and whitespace", () => {
  assert.equal(normalizeVisibleText('<p>  ＹＥＳ! “Ship it” </p>\n<p>don’t  </p>'), 'yes! "ship it" don\'t');
});

test("the chat record identity is the configured lead UUID", () => {
  assert.equal(FLAG_CHAT_RECORD_AGENT_ID, "9b0f3a93-5e88-4093-b558-cad1c229bc51");
});

for (const [fixture, expected] of [
  ["Question: Switch x to Everyone?", [["x", "Everyone"]]],
  ["@Valentin Yeo Question: Switch x to Owner + QA?", [["x", "Owner + QA"]]],
  ["@Valentin Yeo can I switch x? Switch x to Everyone", [["x", "Everyone"]]],
  ["SWITCH HTPR-6371-MOBILE-SEARCH TO EVERYONE?", [["htpr-6371-mobile-search", "Everyone"]]],
  ["Switch x to Only me", [["x", "Only me"]]],
  ["Switch x to Owner + QA", [["x", "Owner + QA"]]],
  ["Switch x to Off", [["x", "Off"]]],
  ["Switch x to Everyone? Switch y to Off?", [["x", "Everyone"], ["y", "Off"]]],
  ["Question: Switch x to Only me?\nSwitch y to Owner + QA?", [["x", "Only me"], ["y", "Owner + QA"]]],
  ["Notification: Switch gift to Everyone? Nothing further", [["gift", "Everyone"]]],
  ["Switch x to Everyone? Switch x to Everyone?", [["x", "Everyone"]]],
  ['He said "Switch hidden to Off?". Switch x to Everyone?', [["x", "Everyone"]]],
  ["Question: Switch x to Everyone? Thanks", [["x", "Everyone"]]],
  ["Switch x to Everyone? and also make it faster", [["x", "Everyone"]]],
  ["Switch htpr-3533-google-calendar-extra to Off?", [["htpr-3533-google-calendar-extra", "Off"]]],
]) {
  test(`parseSwitchQuestion accepts ${JSON.stringify(fixture)}`, () => {
    assert.deepEqual([...parseSwitchQuestion(fixture)], expected);
  });
}

for (const fixture of [
  ...["if", "unless", "only", "instead", "except", "but", "not", "don't", "do not", "never", "no", "wait", "later", "tomorrow", "maybe", "until"].flatMap((word) => [
    `Switch x to Everyone ${word} I approve`,
    `${word} I approve. Switch x to Everyone`,
    `Switch x to Everyone? ${word}. Switch y to Off?`,
  ]),
  "Switch x to Everyone only if I approve tomorrow",
  'Switch x to Everyone? He said "not yet"',
  "Switch x to Everyone hold",
  "Switch x to Everyone? No, keep it.", "No earlier. Switch x to Everyone?",
  "Switch x to Everyone! Nope, keep it", "Switch x to Everyone. Not now", "Switch x to Everyone? Don't do it",
  "Switch x to Everyone? Do not do it", "Switch x to Everyone? Never do it", "Switch x to Everyone? Keep it off",
  "Switch x to Everyone? Stop", "Switch x to Everyone? Hold", "Switch x to Everyone? Cancel",
  "Switch x to Everyone? Try something else instead", "Switch x to Everyone? Proceed unless it fails",
  "Switch x to Everyone\nNo, keep it", "No, keep it\nSwitch x to Everyone",
  "Do not switch x to Everyone", "don't switch x to Everyone", "not switch x to Everyone", "never switch x to Everyone",
  "no switch x to Everyone", "didn't switch x to Everyone", "won't switch x to Everyone", "shouldn't switch x to Everyone",
  "Switch x to Everyone? Do not switch y to Off?", "Switch x to Everyone? Switch x to Off?",
  'He said "Question: Switch x to Everyone?" earlier', '"Switch x to Everyone',
  "Switch x_extra to Everyone", "Switch -x to Everyone", "Switch x- to Everyone", "Switch x--y to Everyone",
  "xswitch x to Everyone", "Switch x to EveryoneElse", "Switch x to Everyone-extra", "Switch x to Off_now",
  'Switch "aside" x to Everyone', "Switch x to Only myself", "Keep x Off, not Everyone", "Recommendation: ready to release", "Yes", "",
]) {
  test(`parseSwitchQuestion refuses ${JSON.stringify(fixture)}`, () => {
    assert.equal(parseSwitchQuestion(fixture), null);
  });
}

for (const [fixture, batchAllowed, expected] of [
  ["Question: Switch x to Everyone?", false, [["x", "Everyone"]]],
  ["  @Valentin Yeo Question:  Switch x to Owner + QA?\n", false, [["x", "Owner + QA"]]],
  ["Valentin Yeo Question: Switch x to Only me?", false, [["x", "Only me"]]],
  ["Question: Switch x to Everyone?\nSwitch y to Off?", true, [["x", "Everyone"], ["y", "Off"]]],
  ["Question: Switch x to Everyone?\nSwitch y to Off?", false, null],
  ["Question: Switch x to Everyone? Switch x to Everyone?", true, null],
  ["@Valentin Yeo can I switch x? Switch x to Everyone", false, null],
  ["Question: Switch x to Everyone? Thanks", false, null],
  ["question: switch x to everyone?", false, null],
  ["Question: Switch ｘ to Everyone?", false, null],
]) {
  test(`strictSwitchRequest ${JSON.stringify(fixture)} with batch ${batchAllowed} is ${expected ? "accepted" : "refused"}`, () => {
    const switches = strictSwitchRequest(fixture, batchAllowed);
    assert.deepEqual(switches ? [...switches] : null, expected);
  });
}
