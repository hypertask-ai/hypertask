const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readCatalog, diffModels } = require("../scripts/model-diff");
const { ticketFor, rollupTicket } = require("../.github/scripts/ai-model-watch.cjs");
const fixture = require("./fixtures/model-diff.json");
const root = path.resolve(__dirname, "..");

function watchTickets() {
  const catalog = readCatalog(fs.readFileSync(path.join(root, "src/lib/aiModelOptions.ts"), "utf8"));
  const findings = diffModels(catalog, structuredClone(fixture)).findings;
  return [
    rollupTicket(findings.filter((finding) => finding.kind === "new-class"), new Date("2026-10-25T12:00:00Z")),
    ...findings.filter((finding) => finding.kind !== "new-class").map(ticketFor),
  ];
}

test("watcher ticket text passes the agent writing check the board applies to agent writes", () => {
  const { assertAgentWriting } = require("./task-route-loader.cjs").load("src/lib/agents/writing.ts", {});
  const tickets = watchTickets();
  assert.ok(tickets.length > 1);
  for (const ticket of tickets) {
    assert.doesNotThrow(
      () => assertAgentWriting("agent-fixture", { title: ticket.title, description: ticket.description }, {}, { create: true, houseRules: true }),
      ticket.title,
    );
  }
});

test("watcher ticket text satisfies the plain language block the board checks on create", async () => {
  const { assertPlainLanguageTicketBlock } = await import("../src/lib/tickets/plainLanguageTicket.mjs");
  const tickets = watchTickets();
  for (const ticket of tickets) {
    assert.doesNotThrow(() => assertPlainLanguageTicketBlock(ticket.description), ticket.title);
  }
});
