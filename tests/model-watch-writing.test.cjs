const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { readCatalog, diffModels } = require("../scripts/model-diff");
const { ticketFor, rollupTicket } = require("../.github/scripts/ai-model-watch.cjs");
const fixture = require("./fixtures/model-diff.json");
const root = path.resolve(__dirname, "..");

function everyFinding() {
  const catalog = readCatalog(fs.readFileSync(path.join(root, "src/lib/aiModelOptions.ts"), "utf8"));
  const unknownPrice = structuredClone(fixture);
  for (const row of unknownPrice.gateway.data) delete row.pricing;
  const twoVersions = {
    definitions: [
      { key: "claude-haiku-4.5", modelClass: "claude-haiku", label: "Haiku 4.5", provider: "anthropic", priceTier: 1 },
      { key: "claude-haiku-5-5", modelClass: "claude-haiku", label: "Haiku 5.5", provider: "anthropic", priceTier: 1 },
    ],
    options: [
      { id: "claude-haiku-4.5", modelKey: "claude-haiku-4.5", model: "claude-haiku-4.5", source: "claude" },
      { id: "claude-haiku-5-5", modelKey: "claude-haiku-5-5", model: "claude-haiku-5.5", source: "claude" },
    ],
  };
  return [
    ...diffModels(catalog, structuredClone(fixture)).findings,
    ...diffModels(catalog, unknownPrice).findings,
    ...diffModels(twoVersions, structuredClone(fixture)).findings.filter((finding) => finding.kind === "stale"),
  ];
}

function tickets() {
  const findings = everyFinding();
  const newClasses = findings.filter((finding) => finding.kind === "new-class");
  assert.ok(newClasses.length > 0);
  assert.ok(findings.some((finding) => finding.kind === "new-version"));
  assert.ok(findings.some((finding) => finding.kind === "stale"));
  assert.ok(findings.some((finding) => finding.inputPerMillion == null));
  return [
    rollupTicket(newClasses, new Date("2026-10-25T12:00:00Z")),
    ...findings.filter((finding) => finding.kind !== "new-class").map(ticketFor),
  ];
}

test("watcher ticket text passes the agent writing check the board applies to agent writes", () => {
  const { assertAgentWriting } = require("./task-route-loader.cjs").load("src/lib/agents/writing.ts", {});
  for (const ticket of tickets()) {
    assert.doesNotThrow(
      () => assertAgentWriting("agent-fixture", { title: ticket.title, description: ticket.description }),
      ticket.title,
    );
  }
});

test("watcher ticket text passes the create-time house rules the board now applies to board 15", () => {
  const { assertAgentWriting } = require("./task-route-loader.cjs").load("src/lib/agents/writing.ts", {});
  for (const ticket of tickets()) {
    assert.doesNotThrow(
      () => assertAgentWriting("agent-fixture", { title: ticket.title, description: ticket.description }, {}, { create: true, houseRules: true }),
      `${ticket.title}: ${ticket.description}`,
    );
  }
});

test("watcher ticket text opens with the plain-language block board 15 requires", async () => {
  const { assertPlainLanguageTicketBlock, hasPlainLanguageTicketBlock } = await import("../src/lib/tickets/plainLanguageTicket.mjs");
  assert.equal(hasPlainLanguageTicketBlock(ticketFor({ kind: "new-version", provider: "openai", model: "openai/gpt-5.5", inputPerMillion: 1, action: "ship automatically", reason: "newer version in an existing class", modelClass: "gpt-5", current: [] }).description), true);
  for (const ticket of tickets()) {
    assert.doesNotThrow(() => assertPlainLanguageTicketBlock(ticket.description), ticket.title);
  }
});

test("watcher reports the board refusal text instead of a bare status code", async () => {
  const { fileFindings } = require("../.github/scripts/ai-model-watch.cjs");
  const finding = everyFinding().find((candidate) => candidate.kind === "new-version");
  const refusal = {
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ success: false, error: "Validation error", message: "description: Problem is missing. Add the missing part in plain words." }),
  };
  await assert.rejects(
    fileFindings({ sourcesUsed: ["gateway"], findings: [finding] }, {
      token: "fixture",
      fetchImpl: async (_url, options) => options.method === "GET" ? { ok: true, status: 200, json: async () => ({ success: true, tasks: [], total: 0 }) } : refusal,
    }),
    /HTTP 400: description: Problem is missing/,
  );
});
