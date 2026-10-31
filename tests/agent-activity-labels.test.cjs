const { readAgentDetailSource } = require("./helpers/agent-detail-source.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/app/api/agents/[agentId]/activity/route.ts"),
  "utf8",
);
const detailSource = readAgentDetailSource();

test("model-usage rows are labelled in user-facing language", () => {
  assert.match(source, /did: "Thought about the work"/);
  assert.doesNotMatch(source, /Ran a turn/);
  assert.doesNotMatch(source, /Called the model/);
});

test("external runtimes do not show unavailable token usage", () => {
  assert.match(
    detailSource,
    /showTokenUsage=\{agent\.runtimeType === "NATIVE"\}/,
  );
  assert.match(detailSource, /showTokenUsage && \(\s*<th[\s\S]*?>\s*Tokens\s*<\/th>/);
  assert.match(detailSource, /showTokenUsage && \(\s*<td[\s\S]*?formatTokens/);
});
