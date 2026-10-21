import assert from "node:assert";
// @ts-expect-error Node strip-types checks require .ts imports without allowImportingTsExtensions.
import { linkifyHtml } from "./linkifyHtml.ts";

assert.strictEqual(
  linkifyHtml("<p>https://claude.ai/code/session_01XmB3</p>"),
  '<p><a href="https://claude.ai/code/session_01XmB3" target="_blank" rel="noopener noreferrer">https://claude.ai/code/session_01XmB3</a></p>',
  "bare url -> anchor",
);

const already = '<p><a href="https://x.com">https://x.com</a></p>';
assert.strictEqual(linkifyHtml(already), already, "existing anchor untouched");

const img = '<img src="https://cdn.example.com/a.png" alt="x">';
assert.strictEqual(linkifyHtml(img), img, "attribute url untouched");

assert.strictEqual(
  linkifyHtml("<p>see https://a.io/b.</p>"),
  '<p>see <a href="https://a.io/b" target="_blank" rel="noopener noreferrer">https://a.io/b</a>.</p>',
  "trailing period excluded",
);

assert.strictEqual(linkifyHtml("<p>plain text</p>"), "<p>plain text</p>", "no-op");

assert.strictEqual(
  linkifyHtml("a https://one.io b https://two.io"),
  'a <a href="https://one.io" target="_blank" rel="noopener noreferrer">https://one.io</a> b <a href="https://two.io" target="_blank" rel="noopener noreferrer">https://two.io</a>',
  "multiple urls",
);

console.log("linkifyHtml: all checks passed");

assert.strictEqual(
  linkifyHtml("<p><strong>after https://a.io/x (https://b.io/pull/1).</strong></p>"),
  '<p><strong>after <a href="https://a.io/x" target="_blank" rel="noopener noreferrer">https://a.io/x</a> (<a href="https://b.io/pull/1" target="_blank" rel="noopener noreferrer">https://b.io/pull/1</a>).</strong></p>',
  "urls inside strong and parentheses",
);
