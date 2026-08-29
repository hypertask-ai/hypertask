const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/blockquote-jiti-entry-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } }
  );
  return jiti(path.join(root, relativePath));
}

const mentions = "src/utils/helperFunctions/multiPages/multipages.functions.ts";
const mentionSpan = (label, name) =>
  `<span data-type="mention" class="mention" data-id="${name}" data-label="${label}">${name}</span>`;
const agent = mentionSpan("agent-inne-wiki", "inne-wiki");
const user = mentionSpan("name-6", "Valentin");

// WHY: quoting a comment that mentioned an agent must NOT re-trigger the agent.
// The agent replies (quoting the mention) -> extraction sees the mention again
// -> the agent is re-notified -> infinite reply loop. Stripping <blockquote>
// content before extraction is what breaks the loop, for EVERY agent (not just
// HyperAI, which was already special-cased client-side). Ref INNE-306.
test("mentions inside a blockquote are not extracted for triggering", () => {
  const { extractTipTapContent, stripBlockquoteContent } = loadTs(mentions);
  const strip = (html) => extractTipTapContent(stripBlockquoteContent(html));

  // A live mention outside any quote still triggers.
  assert.deepEqual(strip(`<p>hey ${agent} look</p>`).agentMentions, ["inne-wiki"]);

  // A mention that only appears inside a quoted reply does not.
  assert.deepEqual(
    strip(`<p>Valentin said <blockquote>${agent} please review</blockquote></p>`).agentMentions,
    []
  );

  // Nested quotes are fully stripped.
  assert.deepEqual(
    strip(`<blockquote>a <blockquote>${agent}</blockquote> b</blockquote>`).agentMentions,
    []
  );

  // A real mention between two quotes survives; the quoted ones are dropped.
  const interleaved = `<blockquote>${agent}</blockquote> ping ${mentionSpan(
    "agent-x",
    "x"
  )} <blockquote>${user}</blockquote>`;
  const out = strip(interleaved);
  assert.deepEqual(out.agentMentions, ["x"]);
  assert.deepEqual(out.mentions, []);

  // User mentions inside a quote are stripped too (no re-notifying a human on a quote).
  assert.deepEqual(strip(`<p>q <blockquote>${user}</blockquote></p>`).mentions, []);
});
