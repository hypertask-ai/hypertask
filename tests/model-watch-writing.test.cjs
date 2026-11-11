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

test("the decision field is a yes or no question, or the word nothing", () => {
  const decisionOf = (description) => description.match(/What Valentin must decide:<\/strong>\s*([^<]+)</)[1].trim();
  for (const ticket of watchTickets()) {
    const decision = decisionOf(ticket.description);
    assert.ok(decision === "nothing." || decision.endsWith("?"), `${ticket.title}: ${decision}`);
  }
});

test("a stale entry tells nobody to add it back, and an unpriced finding waits for its price", () => {
  const base = { current: ["kim"], inputPerMillion: null, provider: "openai", reason: "newer version in an existing class" };
  const stale = ticketFor({ ...base, kind: "stale", model: "openai/gpt-6-luna", modelClass: "gpt-luna", current: ["gpt-6-luna"], action: "remove stale entry; migrate saved picks to the current model of its class" });
  assert.match(stale.description, /Replace the stale entry and move saved picks/);
  assert.doesNotMatch(stale.description, /once Valentin agrees/);
  assert.match(stale.description, /How to undo:<\/strong> point saved picks back at the old version\./);
  const unpriced = ticketFor({ ...base, kind: "new-version", model: "openai/gpt-6.2-luna", modelClass: "gpt-luna", action: "ship automatically when the gateway price is at most $5 per million" });
  assert.match(unpriced.description, /Wait for a verified gateway price/);
  assert.doesNotMatch(unpriced.description, /Replace the old version in every picker/);
  const unknown = ticketFor({ ...base, kind: "stale", model: "claude-haiku-4.5", modelClass: "claude-haiku", current: [], action: "remove stale entry; migrate saved picks to the current model of its class", reason: "picker model missing from gateway list" });
  assert.match(unknown.description, /Confirm the model is retired/);
  assert.match(unknown.description, /How to undo:<\/strong> nothing to undo/);
  assert.doesNotMatch(unknown.description, /the old one no longer answers/);
  const replacement = ticketFor({ ...base, kind: "new-version", provider: "moonshotai", model: "moonshotai/kimi-k3.2", modelClass: "kimi-k", current: ["kimi-k3"], inputPerMillion: 2, action: "ask Valentin before shipping" });
  assert.match(replacement.description, /Replace the old version and move saved picks to the new one/);
});
