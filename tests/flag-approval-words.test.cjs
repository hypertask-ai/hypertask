const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const jiti = createJiti(__filename, { interopDefault: true });
const { normalizeVisibleText, classifyAnswer, parseSwitchQuestion, strictSwitchRequest, isOffOrder, FLAG_CHAT_RECORD_AGENT_ID } = jiti(path.join(__dirname, "../src/lib/flags/approvalWords.ts"));

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

const shapedQuestion = (question) => `<p><strong>What this is:</strong> a flag that keeps a running chat.</p>
<p>It changes what every customer sees.</p>
<p><strong>Question:</strong> ${question}</p>
<p><strong>My recommendation:</strong> Yes.</p>
<p><strong>Why:</strong> live QA passed.</p>
<p><strong>Yes:</strong> everyone gets it.</p>
<p><strong>No:</strong> it stays with me and QA.</p>
<p>Impact: not only the QA account, and it holds until we say otherwise.</p>`;

const { parse: parseHtml } = require("node-html-parser");
const shapedWords = (question) => normalizeVisibleText(shapedQuestion(question));
const shapedText = (question) => parseHtml(shapedQuestion(question)).text;

for (const [question, expected] of [
  ["Switch x to Everyone?", [["x", "Everyone"]]],
  ["Switch x to Only me?", [["x", "Only me"]]],
  ["Switch htpr-7764-chat-running to Owner + QA?", [["htpr-7764-chat-running", "Owner + QA"]]],
]) {
  test(`a Question in the required shape approves ${JSON.stringify(question)}`, () => {
    assert.deepEqual([...parseSwitchQuestion(shapedWords(question), true)], expected);
    assert.deepEqual([...strictSwitchRequest(shapedText(question), false, true)], expected);
  });
}

for (const question of [
  "Switch x to Everyone only if it passes?",
  "Switch x to Everyone unless QA is red?",
  "Do not switch x to Everyone?",
  "Switch x to Everyone? No, keep it.",
  "Switch x to not Everyone?",
]) {
  test(`a shaped Question saying ${JSON.stringify(question)} still refuses`, () => {
    assert.equal(parseSwitchQuestion(shapedWords(question), true), null);
    assert.equal(strictSwitchRequest(shapedText(question), false, true), null);
  });
}

test("a shaped Question refuses while its switch is off, and free wording keeps its guards", () => {
  const question = "Switch x to Everyone?";
  assert.equal(parseSwitchQuestion(shapedWords(question)), null);
  assert.equal(strictSwitchRequest(shapedText(question), false), null);
  assert.equal(parseSwitchQuestion(shapedWords(question).replace(/question\s*:/, "asks:"), true), null);
  assert.equal(parseSwitchQuestion("Switch x to Everyone? No, keep it.", true), null);
  assert.equal(strictSwitchRequest("Question: Switch x to Everyone? Switch y to Off?", false, true), null);
});

const shapedWith = (body) => normalizeVisibleText(`<p><strong>What this is:</strong> a flag that keeps a running chat.</p>${body}
<p><strong>My recommendation:</strong> Yes.</p>
<p><strong>Why:</strong> live QA passed.</p>
<p><strong>Yes:</strong> everyone gets it.</p>
<p><strong>No:</strong> it stays with me and QA.</p>`);

test("a quoted switch request in the context block never approves its own switch", () => {
  const quotedOnly = shapedWith(`<p>He asked "Question: Switch x to Everyone?" last week.</p>`);
  assert.equal(parseSwitchQuestion(quotedOnly, true), null);

  const quotedThenReal = shapedWith(`<p>He asked "Question: Switch x to Everyone?" last week.</p>
<p><strong>Question:</strong> Switch x to Off?</p>`);
  assert.deepEqual([...parseSwitchQuestion(quotedThenReal, true)], [["x", "Off"]]);
});

test("a shaped comment with two Question lines refuses", () => {
  const twoQuestions = shapedWith(`<p><strong>Question:</strong> Switch x to Everyone?</p>
<p><strong>Question:</strong> Switch x to Off?</p>`);
  assert.equal(parseSwitchQuestion(twoQuestions, true), null);
});

for (const recommendation of ["No.", "No, keep it off.", "Yes, but only after QA."]) {
  test(`a shaped comment recommending ${JSON.stringify(recommendation)} refuses a thumbs up`, () => {
    const words = shapedWith(`<p><strong>Question:</strong> Switch x to Everyone?</p>`)
      .replace("my recommendation: yes.", `my recommendation: ${recommendation.toLowerCase()}`);
    assert.equal(parseSwitchQuestion(words, true), null);
  });
}

for (const [name, body] of [
  ["a quoted hedge inside the Question line", `<p><strong>Question:</strong> Switch x to "not" Everyone?</p>`],
  ["a quoted hedge after the Question line", `<p><strong>Question:</strong> Switch x to Everyone? "not yet"</p>`],
  ["a quoted No recommendation", `<p><strong>Question:</strong> Switch x to Everyone?</p><p><strong>My recommendation:</strong> "No."</p>`],
]) {
  test(`a shaped comment with ${name} refuses in both lanes`, () => {
    const words = shapedWith(body).replace(/my recommendation: yes\./, "");
    assert.equal(parseSwitchQuestion(words, true), null);
    const text = require("node-html-parser").parse(`<p><strong>What this is:</strong> a flag.</p>${body}
<p><strong>My recommendation:</strong> Yes.</p>
<p><strong>Why:</strong> live QA passed.</p>
<p><strong>Yes:</strong> everyone gets it.</p>
<p><strong>No:</strong> it stays with me and QA.</p>`).text;
    assert.equal(strictSwitchRequest(text, false, true), null);
  });
}

for (const [expected, fixtures] of [
  [true, ["so the design is a complete mess right now can you toggle off the flag for the ctrl+j change?",
    "turn the flag off for graphite too its full of bugs", "wtf just turn off the feature flags?????????",
    "switch it off", "Turn off", "disable the flag, turn it off"]],
  [false, ["turn it on", "yes", "ship it", "do not turn it off", "don't switch it off", "turn it off later", "", "off"]],
]) {
  for (const fixture of fixtures) {
    test(`isOffOrder ${JSON.stringify(fixture)} is ${expected}`, () => {
      assert.equal(isOffOrder(fixture), expected);
    });
  }
}

test("an Off order is not a yes, so other modes still refuse it", () => {
  assert.equal(classifyAnswer("wtf just turn off the feature flags?????????"), "unclear");
  assert.equal(classifyAnswer("yes"), "yes");
});
