const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("typography references match the production theme fonts", () => {
  const typographyGuide = read(".claude/skills/reuse-existing-ui/reference/typography.md");
  const designGuide = read("docs/DESIGN.md");
  const typographyCard = read("design-system/tokens/typography.html");

  for (const reference of [typographyGuide, designGuide, typographyCard]) {
    assert.match(reference, /IBM Plex Sans/);
    assert.match(reference, /Newsreader/);
  }

  assert.doesNotMatch(typographyGuide, /type scale \(Inter\)/);
  assert.doesNotMatch(designGuide, /Font:\*\* no custom stack/);
  assert.match(
    typographyCard,
    /font-family:\s*var\(--font-ui\)/,
    "the visual typography reference must render with its UI font token",
  );
});
