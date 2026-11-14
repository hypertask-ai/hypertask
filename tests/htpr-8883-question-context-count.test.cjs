const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const { assertAgentWriting } = load("src/lib/agents/writing.ts", {});

const phoneUnlock = `<p><strong>What this is:</strong> The phone must be unlocked for the check.</p>
<ul>
<li><p>Problem: QA cannot open the app while the phone is locked.</p></li>
<li><p>Reason: the check needs the phone in hand.</p></li>
<li><p>Outcomes: the check passes or stays blocked.</p></li>
<li><p><strong>Question:</strong> Unlock the phone?</p></li>
</ul>
<p><strong>My recommendation:</strong> Yes.</p>
<p><strong>Why:</strong> Someone must be there to unlock it.</p>
<p><strong>Yes:</strong> Unlock it for the check.</p>
<p><strong>No:</strong> Leave it locked.</p>`;

test("three context points plus the question list item are accepted", () => {
  assert.doesNotThrow(() => assertAgentWriting("agent", { text: phoneUnlock }, {}, { houseRules: true }));
});

test("three context points are accepted when list items omit their closing tag", () => {
  const openItems = phoneUnlock.replaceAll("</li>", "");
  assert.doesNotThrow(() => assertAgentWriting("agent", { text: openItems }, {}, { houseRules: true }));
});

test("four context points plus the question are refused", () => {
  const four = phoneUnlock.replace(
    "<li><p><strong>Question:</strong>",
    "<li><p>Extra: one more point.</p></li><li><p><strong>Question:</strong>",
  );
  assert.throws(() => assertAgentWriting("agent", { text: four }, {}, { houseRules: true }), /three points/);
});

test("four context points in a closed list before a later question are refused", () => {
  const text = `<p><strong>What this is:</strong> The check needs the phone.</p>
<ul><li>Problem: one.<li>Reason: two.<li>Outcomes: three.<li>Extra: four.</ul>
<p><strong>Question:</strong> Continue?</p>
<p><strong>My recommendation:</strong> Yes.</p>
<p><strong>Why:</strong> The count must hold.</p>
<p><strong>Yes:</strong> Count four.</p>
<p><strong>No:</strong> Ignore it.</p>`;
  assert.throws(() => assertAgentWriting("agent", { text }, {}, { houseRules: true }), /three points/);
});

test("context points inside a quoted block do not count", () => {
  const quoted = phoneUnlock.replace(
    "<p><strong>What this is:</strong>",
    `<blockquote><ul><li><p>Old point one.</p></li><li><p>Old point two.</p></li><li><p>Old point three.</p></li><li><p>Old point four.</p></li></ul></blockquote><p><strong>What this is:</strong>`,
  );
  assert.doesNotThrow(() => assertAgentWriting("agent", { text: quoted }, {}, { houseRules: true }));
});
