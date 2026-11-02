const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readCatalog, diffModels } = require("../scripts/model-diff");
const { ticketFor, rollupTicket } = require("../.github/scripts/ai-model-watch.cjs");
const { load } = require("./task-route-loader.cjs");
const fixture = require("./fixtures/model-diff.json");

const root = path.resolve(__dirname, "..");
const catalog = readCatalog(fs.readFileSync(path.join(root, "src/lib/aiModelOptions.ts"), "utf8"));
const { assertAgentWriting } = load("src/lib/agents/writing.ts", {});

test("every ticket the model watch writes passes the production plain-writing rule", () => {
  const findings = diffModels(catalog, structuredClone(fixture)).findings;
  assert.ok(findings.length > 0, "the fixture must produce findings");
  const tickets = findings.map(ticketFor);
  tickets.push(rollupTicket(findings.filter((finding) => finding.kind === "new-class").slice(0, 3), new Date("2026-10-25T12:00:00Z")));
  tickets.push(ticketFor({ ...findings[0], inputPerMillion: null }));
  for (const ticket of tickets) {
    assert.doesNotThrow(() => assertAgentWriting("modelwatch", { title: ticket.title, description: ticket.description }), ticket.title);
  }
});

test("the rule still refuses the wording the watch used before this fix", () => {
  const before = "<p><strong>Ship automatically.</strong></p><p>Newer version in an existing class. Class: <code>claude-sonnet</code>. Current: claude-sonnet-5.5.</p><p>Gateway input price per million tokens: $3.</p><p>Follow <code>.claude/skills/update-ai-models/SKILL.md</code>: replace the old version in every picker, migrate saved picks, verify gateway input/output prices and get a live chat answer after release.</p>";
  assert.throws(() => assertAgentWriting("modelwatch", { description: before }), /Technical details belong in the agent log/);
});
