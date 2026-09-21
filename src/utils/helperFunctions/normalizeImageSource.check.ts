// Run: npx tsx normalizeImageSource.check.ts
import assert from "node:assert";
import {
  normalizeImageSource,
  normalizeImageSourcesInHtml,
} from "./normalizeImageSource";

assert.strictEqual(
  normalizeImageSource("https://screencast2.com/d9cst.png"),
  "https://screencast2.com/d9cst.png?raw",
  "Screencast2 share URLs use the raw image response",
);

assert.strictEqual(
  normalizeImageSource(
    "https://www.screencast2.com/example.webp?download=1#preview",
  ),
  "https://www.screencast2.com/example.webp?download=1&raw#preview",
  "existing queries and fragments are preserved",
);

assert.strictEqual(
  normalizeImageSource("https://screencast2.com/example.jpg?raw"),
  "https://screencast2.com/example.jpg?raw",
  "raw URLs are idempotent",
);

for (const unchanged of [
  "https://cdn.example.com/example.png",
  "https://screencast2.com/not-an-image",
  "/relative/image.png",
  "not a URL",
  "",
]) {
  assert.strictEqual(
    normalizeImageSource(unchanged),
    unchanged,
    `unrelated source remains unchanged: ${unchanged}`,
  );
}

assert.strictEqual(
  normalizeImageSourcesInHtml(
    '<p><a href="https://screencast2.com/a.png">link</a><img alt="a" src="https://screencast2.com/a.png"><img src=\'https://cdn.example.com/b.png\'></p>',
  ),
  '<p><a href="https://screencast2.com/a.png">link</a><img alt="a" src="https://screencast2.com/a.png?raw"><img src=\'https://cdn.example.com/b.png\'></p>',
  "only matching image sources are rewritten in rich HTML",
);

assert.strictEqual(
  normalizeImageSourcesInHtml(
    '<img data-src="https://screencast2.com/lazy.png" alt="lazy">',
  ),
  '<img data-src="https://screencast2.com/lazy.png" alt="lazy">',
  "similarly named attributes are not treated as the active image source",
);

console.log("normalizeImageSource: all checks passed");
