// Runnable check for the HTPR-3779 comment URL linkifier.
// Run: node --experimental-strip-types src/utils/helperFunctions/linkifyHtml.check.ts
import assert from "node:assert";
// @ts-ignore -- explicit .ts extension is required by `node --experimental-strip-types`
import { linkifyHtml } from "./linkifyHtml.ts";

// Bare URL in a paragraph -> wrapped in an anchor (the core CLI-comment bug).
assert.strictEqual(
  linkifyHtml("<p>https://claude.ai/code/session_01XmB3</p>"),
  '<p><a href="https://claude.ai/code/session_01XmB3" target="_blank" rel="noopener noreferrer">https://claude.ai/code/session_01XmB3</a></p>',
  "bare url -> anchor",
);

// URL already inside an <a> -> untouched, never double-wrapped.
const already = '<p><a href="https://x.com">https://x.com</a></p>';
assert.strictEqual(linkifyHtml(already), already, "existing anchor untouched");

// URL inside an attribute (img src) -> not mangled into a nested anchor.
const img = '<img src="https://cdn.example.com/a.png" alt="x">';
assert.strictEqual(linkifyHtml(img), img, "attribute url untouched");

// Trailing sentence punctuation stays outside the link.
assert.strictEqual(
  linkifyHtml("<p>see https://a.io/b.</p>"),
  '<p>see <a href="https://a.io/b" target="_blank" rel="noopener noreferrer">https://a.io/b</a>.</p>',
  "trailing period excluded",
);

// No URL -> returned unchanged (fast path).
assert.strictEqual(linkifyHtml("<p>plain text</p>"), "<p>plain text</p>", "no-op");

// Two bare URLs in one text node -> both linkified.
assert.strictEqual(
  linkifyHtml("a https://one.io b https://two.io"),
  'a <a href="https://one.io" target="_blank" rel="noopener noreferrer">https://one.io</a> b <a href="https://two.io" target="_blank" rel="noopener noreferrer">https://two.io</a>',
  "multiple urls",
);

console.log("linkifyHtml: all checks passed");
