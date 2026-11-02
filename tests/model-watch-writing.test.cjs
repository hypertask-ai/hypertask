const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readCatalog, diffModels } = require("../scripts/model-diff");
const { ticketFor, rollupTicket } = require("../.github/scripts/ai-model-watch.cjs");
const fixture = require("./fixtures/model-diff.json");
const root = path.resolve(__dirname, "..");

test("watcher ticket text passes the agent writing check the board applies to agent writes", () => {
  const { assertAgentWriting } = require("./task-route-loader.cjs").load("src/lib/agents/writing.ts", {});
  const catalog = readCatalog(fs.readFileSync(path.join(root, "src/lib/aiModelOptions.ts"), "utf8"));
  const findings = diffModels(catalog, structuredClone(fixture)).findings;
  const tickets = [
    rollupTicket(findings.filter((finding) => finding.kind === "new-class"), new Date("2026-10-25T12:00:00Z")),
    ...findings.filter((finding) => finding.kind !== "new-class").map(ticketFor),
  ];
  const shapes = [
    { kind: "new-version", provider: "anthropic", action: "confirm the gateway price first; ship automatically under $5 per million input tokens" },
    { kind: "new-version", provider: "openai", action: "ship automatically" },
    { kind: "new-version", provider: "other", action: "ask Valentin before shipping" },
    { kind: "stale", provider: "anthropic", action: "remove stale entry; migrate saved picks to the current model of its class" },
    { kind: "new-class", provider: "other", action: "waits for HTPR-7746" },
  ];
  tickets.push(...shapes.map((shape) => ticketFor({
    model: `${shape.provider}/gpt-6.2-sol`, modelClass: "sol", current: ["claude-sonnet-5-5"],
    inputPerMillion: null, reason: "not in the current catalog", ...shape,
  })));
  assert.ok(tickets.length > 1);
  for (const ticket of tickets) {
    assert.doesNotThrow(
      () => assertAgentWriting("agent-fixture", { title: ticket.title, description: ticket.description }),
      ticket.title,
    );
  }
});
