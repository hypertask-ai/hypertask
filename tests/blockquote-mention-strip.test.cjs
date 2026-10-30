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

test("mentions inside a blockquote are not extracted for triggering", () => {
  const { extractTipTapContent, stripBlockquoteContent } = loadTs(mentions);
  const strip = (html) => extractTipTapContent(stripBlockquoteContent(html));

  assert.deepEqual(strip(`<p>hey ${agent} look</p>`).agentMentions, ["inne-wiki"]);

  assert.deepEqual(
    strip(`<p>Valentin said <blockquote>${agent} please review</blockquote></p>`).agentMentions,
    []
  );

  assert.deepEqual(
    strip(`<blockquote>a <blockquote>${agent}</blockquote> b</blockquote>`).agentMentions,
    []
  );

  const interleaved = `<blockquote>${agent}</blockquote> ping ${mentionSpan(
    "agent-x",
    "x"
  )} <blockquote>${user}</blockquote>`;
  const out = strip(interleaved);
  assert.deepEqual(out.agentMentions, ["x"]);
  assert.deepEqual(out.mentions, []);

  assert.deepEqual(strip(`<p>q <blockquote>${user}</blockquote></p>`).mentions, []);
});
