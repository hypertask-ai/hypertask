const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

// HTPR-6802: CLI/API descriptions with bare URLs rendered as plain text in the
// task detail editor, because only typed or pasted URLs get the Link mark.
test("task detail description editor receives linkified content", () => {
  const body = fs.readFileSync(
    path.join(
      root,
      "src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptonBody.tsx",
    ),
    "utf8",
  );

  assert.match(body, /import \{ linkifyHtml \} from "@\/utils\/helperFunctions\/linkifyHtml";/);
  assert.match(body, /linkifyHtml\(content\)/);
  assert.match(body, /defaultContent=\{linkedContent\}/);
  assert.doesNotMatch(body, /defaultContent=\{content\}/);
});
