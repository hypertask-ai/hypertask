const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const tailwindConfig = read("tailwind.config.ts");
const viewTabs = read(
  "src/components/PageComponents/Kanban/HeaderComponents/ViewTabsBar.tsx",
);
const inboxSplitTitle = read(
  "src/components/notifications/inboxSplit/SplitTitle.tsx",
);

const classTokens = (match, target) => {
  assert.ok(match, `${target} class list not found`);
  return new Set(match[1].split(/\s+/).filter(Boolean));
};

test("sidebar board names and inbox split tabs use the 14px content token", () => {
  const fontSizeConfig = tailwindConfig.match(
    /fontSize\s*:\s*\{([\s\S]*?)\n\s*\},\n\s*boxShadow/,
  );
  assert.ok(fontSizeConfig, "Tailwind fontSize configuration not found");
  assert.match(fontSizeConfig[1], /["']content["']\s*:\s*["']14px["']/);

  const targets = [
    [
      "sidebar board tab",
      classTokens(
        viewTabs.match(/appShellRail\s*\?\s*cn\(\s*'([^']+)'/),
        "sidebar board tab",
      ),
    ],
    [
      "inbox split tab",
      classTokens(
        inboxSplitTitle.match(
          /className=\{`([^`]+)`\}\s*onClick=\{onClick\}/,
        ),
        "inbox split tab",
      ),
    ],
  ];

  for (const [target, tokens] of targets) {
    assert.equal(tokens.has("text-content"), true, `${target} must use text-content`);
    assert.equal(tokens.has("text-[14.5px]"), false, `${target} must not use 14.5px`);
  }
});
