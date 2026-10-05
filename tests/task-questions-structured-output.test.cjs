// HTPR-6953: task question suggestions crashed on model text with a stray
// quote ("Expected ',' or ']' after array element in JSON"). The route must
// ask for structured output instead of parsing model text by hand.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const route = fs.readFileSync(
  path.join(__dirname, "../src/app/api/ai/task-questions/route.ts"),
  "utf8",
);

test("task questions use structured output, not JSON.parse of model text", () => {
  assert.match(route, /output:\s*Output\.object\(\{\s*schema:\s*taskQuestionsOutputSchema\s*\}\)/);
  assert.match(route, /questions:\s*z\.array\(z\.string\(\)\)/);
  assert.doesNotMatch(route, /JSON\.parse\(/);
  assert.match(route, /result\.output\.questions/);
});

test("task questions still fall back to an empty list on failure", () => {
  assert.match(route, /stage: "empty-questions-fallback"/);
  assert.match(route, /return NextResponse\.json\(\{ questions: \[\] \}\);\s*\}\s*\}\s*$/);
});
