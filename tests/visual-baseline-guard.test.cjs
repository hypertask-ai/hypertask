// HTPR-5652 — the visual gate is only a gate if its baselines are harder to
// change than the code. These tests pin the rule that lets a deliberate visual
// change through and stops a silent one.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const guardUrl = pathToFileURL(
  path.join(__dirname, "..", ".github", "scripts", "visual-baseline-guard.mjs"),
).href;

const load = () => import(guardUrl);

test("a pull request that leaves the baselines alone passes", async () => {
  const { evaluateBaselineChange } = await load();
  const result = evaluateBaselineChange({
    changedFiles: ["src/components/Board/Board.tsx", "tests/board.test.cjs"],
    prBody: "Fixes the drag handle.",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.baselineFiles, []);
});

test("rewriting a baseline without declaring it is rejected", async () => {
  const { evaluateBaselineChange } = await load();
  const result = evaluateBaselineChange({
    changedFiles: [
      "src/components/Search/SearchComp.tsx",
      "visual/baseline/desktop-1440/search-amoled.png",
    ],
    prBody: "Small search tweak.",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.baselineFiles, ["visual/baseline/desktop-1440/search-amoled.png"]);
  assert.match(result.reason, /Visual change/);
});

test("rewriting a baseline is allowed once the pull request declares the visual change", async () => {
  const { evaluateBaselineChange } = await load();
  const result = evaluateBaselineChange({
    changedFiles: ["visual/baseline/mobile-390/board-porcelain.png"],
    prBody: "Summary\n\n## Visual change\n\nThe board header lost its divider.",
  });
  assert.equal(result.ok, true);
});

test("deleting a baseline counts as changing it", async () => {
  const { evaluateBaselineChange } = await load();
  const result = evaluateBaselineChange({
    changedFiles: ["visual/baseline/desktop-1440/inbox-amoled.png"],
    prBody: "Removed a screen.",
  });
  assert.equal(result.ok, false);
});

test("the heading must be a heading, not the words inside a sentence", async () => {
  const { declaresVisualChange } = await load();
  // Negative control: prose that mentions the phrase must not satisfy the gate.
  assert.equal(declaresVisualChange("There is no ## Visual change here, honestly."), false);
  assert.equal(declaresVisualChange("Nothing visual changed in this PR."), false);
  // Positive control against the same checker.
  assert.equal(declaresVisualChange("## Visual change\nMoved the button."), true);
  assert.equal(declaresVisualChange("### visual change\nlowercase heading"), true);
  assert.equal(declaresVisualChange("body\n\n  ## Visual Change\ndetail"), true);
  // A person declaring the change writes the plural or the past tense as
  // readily as the singular. Rejecting those failed honest pull requests.
  assert.equal(declaresVisualChange("## Visual changes\nTwo buttons moved."), true);
  assert.equal(declaresVisualChange("## Visual changed\nThe divider went."), true);
  // Still a heading, still the phrase: a longer word must not sneak through.
  assert.equal(declaresVisualChange("## Visual changelog policy"), false);
});

test("an empty or missing pull request body cannot approve a baseline rewrite", async () => {
  const { evaluateBaselineChange } = await load();
  for (const prBody of ["", null, undefined]) {
    const result = evaluateBaselineChange({
      changedFiles: ["visual/baseline/desktop-1440/board-amoled.png"],
      prBody,
    });
    assert.equal(result.ok, false, `body ${JSON.stringify(prBody)} must not pass`);
  }
});

test("the changed-file list is read verbatim from the file CI writes", async () => {
  const { readChangedFilesFile } = await load();
  const file = path.join(require("node:os").tmpdir(), `ht-5652-${process.pid}.txt`);
  require("node:fs").writeFileSync(file, "docs/ci.md\n\nsrc/app/page.tsx\n");
  try {
    // Blank lines are dropped; nothing else is inferred. A branch that forked
    // before the baselines landed never appears in this list, which is the
    // whole reason CI stopped diffing against a moving base tip.
    assert.deepEqual(readChangedFilesFile(file), ["docs/ci.md", "src/app/page.tsx"]);
  } finally {
    require("node:fs").unlinkSync(file);
  }
});
