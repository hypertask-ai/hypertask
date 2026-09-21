const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

test("Inbox comment previews keep the server value through hydration", () => {
  const source = read("src/components/notifications/NotificationRow.tsx");

  assert.doesNotMatch(
    source,
    /typeof window !== ["']undefined["'][\s\S]{0,120}notification\.type === ["']Comment["']/,
  );
  assert.match(source, /const hydrated = useHydrated\(\)/);
  assert.match(
    source,
    /notification\.type === ["']Comment["'][\s\S]{0,120}hydrated[\s\S]{0,120}renderCommentPreview/,
  );
});

test("AI welcome suggestions do not randomize until hydration completes", () => {
  const source = read("src/components/AI_CHAT/WelcomeScreen.tsx");
  const suggestions = source.slice(
    source.indexOf("const suggestions = useMemo"),
    source.indexOf("// HTPR-4882"),
  );

  assert.match(source, /const hydrated = useHydrated\(\)/);
  assert.match(suggestions, /if \(!hydrated\) return/);
  assert.ok(
    suggestions.indexOf("if (!hydrated) return") <
      suggestions.indexOf("shuffleAndTake("),
    "the hydration guard must run before render-time randomization",
  );
});
