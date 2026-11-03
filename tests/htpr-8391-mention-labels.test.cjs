const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

const { injectMentionSpans, normalizeMentionSpans } = load(
  "src/utils/controllers/comments/resolveMentions.ts",
);

const LEAD_AGENT_ID = "9b0f3a93-5e88-4093-b558-cad1c229bc51";
const members = [
  { id: 6, displayName: "Valentin Yeo" },
  { id: 193, displayName: "Abdul Wahhab" },
  { id: LEAD_AGENT_ID, displayName: "HT Product Lead" },
];

const personSpan = (label) =>
  `<p><span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="${label}" data-mention-suggestion-char="@">Valentin Yeo</span></p>`;

test("a guessed person label is rewritten to the member's real label", () => {
  const out = normalizeMentionSpans(personSpan("valentin-6"), members);
  assert.match(out, /data-label="name-6"/);
  assert.match(out, /data-id="Valentin Yeo"/);
  assert.doesNotMatch(out, /valentin-6/);
});

test("a person mention carrying an agent label points back at the person", () => {
  const out = normalizeMentionSpans(personSpan(`agent-${LEAD_AGENT_ID}`), members);
  assert.match(out, /data-label="name-6"/);
  assert.doesNotMatch(out, /data-label="agent-/);
});

test("an agent mention keeps its agent label and display name", () => {
  const agent = `<p><span data-type="mention" class="mention" data-id="HT Product Lead" data-label="agent-${LEAD_AGENT_ID}">HT Product Lead</span></p>`;
  assert.equal(normalizeMentionSpans(agent, members), agent);
});

test("canonical spans are left byte-identical", () => {
  const html = `<p>${injectMentionSpans("ping @Valentin Yeo now", members)}</p>`;
  assert.equal(normalizeMentionSpans(html, members), html);
});

test("an @ inside the mention text is dropped, so no span nests in a span", () => {
  const html = `<p><span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="valentin-6">@Valentin Yeo</span> shipped it.</p>`;
  const normalized = normalizeMentionSpans(html, members);
  const out = injectMentionSpans(normalized, members);
  assert.match(out, /data-label="name-6"/);
  assert.equal(out.match(/<span/g).length, 1);
  assert.match(out, />Valentin Yeo<\/span> shipped it\./);
});

test("injection never writes a mention span inside an existing mention span", () => {
  const html = `<p><span data-type="mention" class="mention" data-id="Somebody Else" data-label="name-404">@Valentin Yeo</span> and @Abdul Wahhab</p>`;
  const out = injectMentionSpans(html, members);
  assert.match(out, /data-label="name-404">@Valentin Yeo<\/span>/);
  assert.match(out, /and <span[^>]*data-label="name-193"/);
});

test("an unknown name and label are left untouched", () => {
  const html = `<p><span data-type="mention" class="mention" data-id="Ghost Person" data-label="name-999">Ghost Person</span></p>`;
  assert.equal(normalizeMentionSpans(html, members), html);
});

test("an ambiguous display name falls back to the label", () => {
  const twoSaras = [
    { id: 1, displayName: "Sara Lee" },
    { id: 2, displayName: "Sara Lee" },
    { id: 6, displayName: "Valentin Yeo" },
  ];
  const html = `<p><span data-type="mention" class="mention" data-id="Sara Lee" data-label="name-2">Sara Lee</span></p>`;
  assert.match(normalizeMentionSpans(html, twoSaras), /data-label="name-2"/);
});

test("display names are escaped when the span is rewritten", () => {
  const risky = [{ id: 7, displayName: 'Bob" onmouseover="alert' }];
  const html = `<p><span data-type="mention" class="mention" data-id="bob" data-label="name-7">Bob</span></p>`;
  const out = normalizeMentionSpans(html, risky);
  assert.match(out, /data-id="Bob&quot; onmouseover=&quot;alert"/);
  assert.match(out, /data-label="name-7"/);
  assert.doesNotMatch(out, /onmouseover="alert"/);
});

test("plain text mentions still resolve for people, agents and emails", () => {
  assert.match(injectMentionSpans("ping @6", members), /data-label="name-6"/);
  assert.match(
    injectMentionSpans("@HT Product Lead run it", members),
    new RegExp(`data-label="agent-${LEAD_AGENT_ID}"`),
  );
  assert.equal(
    injectMentionSpans("mail val@valentin.io", members),
    "mail val@valentin.io",
  );
});
