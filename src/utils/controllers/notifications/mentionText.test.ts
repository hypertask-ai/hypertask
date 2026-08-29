import assert from "node:assert/strict";
import test from "node:test";
import {
  mentionPlainPreview,
  mentionQuoteHtml,
} from "./mentionText";

const mention =
  '<span data-type="mention" data-id="Alice" data-label="name-1" class="mention">Alice</span>';

test("restores the @ before mention labels", () => {
  assert.equal(mentionPlainPreview(`<p>Hello ${mention}</p>`), "Hello @Alice");
});

test("wraps mentions in highlighted HTML", () => {
  assert.equal(
    mentionQuoteHtml(`<p>Hello ${mention}</p>`),
    'Hello <span style="background-color:#f9efcb;color:#1365a3;border-radius:3px;padding:0 3px;" class="mention-hl">@Alice</span>'
  );
});

test("escapes surrounding text and strips nested tags from mention labels", () => {
  const nestedMention =
    '<span data-type="mention"><strong>Alice &amp; Bob</strong></span>';

  assert.equal(
    mentionQuoteHtml(
      `<p>&lt;script&gt;alert("x")&lt;/script&gt; &amp; ${nestedMention}</p>`
    ),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; <span style="background-color:#f9efcb;color:#1365a3;border-radius:3px;padding:0 3px;" class="mention-hl">@Alice &amp; Bob</span>'
  );
});

test("renders a mention cut by truncation as plain escaped text", () => {
  const preview = mentionQuoteHtml(`<p>${mention}</p>`, 5);

  assert.equal(preview, "@Ali…");
  assert.doesNotMatch(preview, /mention-hl|\uE000/);
});

test("a sentinel character in the comment cannot fake a mention", () => {
  const smuggled = mentionQuoteHtml("<p>a\uE000fake\uE000b</p>");

  assert.equal(smuggled, "afakeb");
  assert.doesNotMatch(smuggled, /mention-hl|\uE000/);
});

test("escapes raw angle brackets inside a mention label", () => {
  const raw = mentionQuoteHtml(
    '<p><span data-type="mention">a&lt;b&gt;c</span></p>'
  );

  assert.match(raw, /a&lt;b&gt;c/);
  assert.doesNotMatch(raw, /<b>/);
});

test("does not treat data-type=\"mention\" inside another attribute as a mention", () => {
  const spoof = mentionQuoteHtml(
    `<p><span title='data-type="mention"'>ordinary</span></p>`
  );

  assert.equal(spoof, "ordinary");
});

test("still matches a mention span whose attributes are reordered or unquoted", () => {
  const reordered = mentionQuoteHtml(
    '<p><span class="mention" data-label="name-1" data-type=mention>Alice</span></p>'
  );

  assert.match(reordered, /mention-hl/);
  assert.match(reordered, /@Alice/);
});

test("returns escaped preview HTML when no mention is present", () => {
  assert.equal(
    mentionQuoteHtml("<p>Fish &amp; &lt;chips&gt;</p>"),
    "Fish &amp; &lt;chips&gt;"
  );
});

test("keeps the html quote within the same budget as the plain preview", () => {
  const html = `<p>${"\u{1F600}".repeat(140)}Z</p>`;

  const plain = mentionPlainPreview(html, 140);
  const quote = mentionQuoteHtml(html, 140);

  assert.ok(plain.length <= 140, `plain was ${plain.length}`);
  assert.ok(quote.length <= 140, `quote was ${quote.length}`);
});

test("a non-positive limit yields no quote at all", () => {
  assert.equal(mentionQuoteHtml("<p>secret text</p>", 0), "");
});
