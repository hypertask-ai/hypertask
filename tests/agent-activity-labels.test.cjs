const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/app/api/agents/[agentId]/activity/route.ts"),
  "utf8",
);

// Activity rows are read by board owners, not by agent authors, so the label
// has to name the event in product language. "Ran a turn" (HTPR-5473) is
// internal agent-loop vocabulary and told the reader nothing.
// Its first replacement, "Called the model", was the same mechanism jargon.
// The column header is "Did", so every label reads as a plain past-tense
// action the agent took.
test("model-usage rows are labelled in user-facing language", () => {
  assert.match(source, /did: "Thought about the work"/);
  assert.doesNotMatch(source, /Ran a turn/);
  assert.doesNotMatch(source, /Called the model/);
});
