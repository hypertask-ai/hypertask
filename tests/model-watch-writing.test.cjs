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

test("watcher keeps each finding's action in the per-model ticket body", () => {
  const findings = everyFinding().filter((finding) => finding.kind !== "new-class");
  assert.ok(findings.length > 0);
  for (const finding of findings) {
    const body = ticketFor(finding).description;
    for (const clause of finding.action.split(";").map((part) => part.trim()).filter(Boolean)) {
      assert.ok(body.includes(clause), `${finding.kind}: ${clause}`);
    }
  }
});

test("watcher names the prerequisite before shipping each kind of finding", () => {
  const base = { kind: "new-version", provider: "openai", model: "openai/gpt-5.5", modelClass: "gpt-5", current: [] };
  const decision = (finding) => ticketFor(finding).description.split("<p>Decision</p>")[1];
  assert.match(decision({ ...base, inputPerMillion: 9, action: "waits for HTPR-7746" }), /HTPR-7746 ships the premium gate first\./);
  assert.match(decision({ ...base, inputPerMillion: null, action: "ship automatically when the gateway price is at most $5 per million" }), /The gateway price is checked first\./);
  assert.match(decision({ ...base, inputPerMillion: 2, action: "ship automatically" }), /Nothing; a runner ships it\./);
  assert.match(decision({ ...base, kind: "stale", inputPerMillion: null, action: "remove stale entry; migrate saved picks to the current model of its class" }), /Nothing; a runner removes the stale entry\./);
  assert.match(decision({ ...base, provider: "meta", inputPerMillion: 1, action: "ask Valentin before shipping" }), /Valentin must say yes before this model ships\./);
  assert.match(decision({ ...base, provider: "meta", inputPerMillion: 9 }), /HTPR-7746 ships the premium gate first\. Valentin must then say yes before this model ships\./);
  assert.match(decision({ ...base, provider: "meta", inputPerMillion: null }), /The gateway price is checked first\. Valentin must then say yes before this model ships\./);
  assert.doesNotMatch(decision({ ...base, inputPerMillion: 9 }), /Valentin must/);
  assert.match(decision({ ...base, kind: "new-class", provider: "openai", inputPerMillion: 1 }), /Valentin must say yes before this model ships\./);
});

test("watcher keeps every current catalog entry and says when the audience count is unknown", () => {
  const finding = { kind: "stale", provider: "meta", model: "meta/llama-4", modelClass: "llama", current: ["llama-4-a", "llama-4-b", "llama-4-c", "llama-4-d"], action: "remove stale entry" };
  const body = ticketFor(finding).description;
  for (const key of finding.current) assert.ok(body.includes(key), key);
  assert.match(body, /Who it affects:<\/strong> people who pick a model in chat; the count is unknown\.<\/p>/);
  assert.match(rollupTicket([{ ...finding, kind: "new-class", inputPerMillion: 1 }]).description, /the count is unknown/);
});

test("watcher keeps internal ids and prerequisites below the plain-language divider", () => {
  for (const ticket of tickets()) {
    const [plain, parts = ""] = ticket.description.split("<hr>");
    assert.doesNotMatch(plain, /\b(?:htpr|hyci)-\d+/i, ticket.title);
    assert.ok(parts.length > 0, ticket.title);
    const decide = plain.match(/What Valentin must decide:<\/strong> ([^<]+)</)[1];
    assert.ok(
      decide === "nothing" || decide.endsWith("?"),
      `${ticket.title}: ${decide}`,
    );
  }
});

test("watcher rollup names the premium gate instead of authorising every class", () => {
  const base = { kind: "new-class", provider: "meta", modelClass: "llama" };
  const cheap = { ...base, model: "meta/llama-5", inputPerMillion: 1, action: "ask Valentin before shipping" };
  const premium = { ...base, model: "meta/llama-5-pro", inputPerMillion: 9, action: "waits for HTPR-7746" };
  const mixed = rollupTicket([cheap, premium], new Date("2026-10-25T12:00:00Z"));
  const [mixedPlain, mixedParts] = mixed.description.split("<hr>");
  assert.match(mixedPlain, /What Valentin must decide:<\/strong> May these model classes ship once the earlier steps are done\?<\/p>/);
  assert.match(mixedParts, /1 of these wait for the price check or HTPR-7746\. Valentin must then say yes before they ship\./);
  const allGated = rollupTicket([{ ...premium, model: "meta/llama-5-pro" }, { ...cheap, model: "meta/llama-6", inputPerMillion: null }], new Date("2026-10-25T12:00:00Z"));
  assert.match(allGated.description.split("<hr>")[0], /What Valentin must decide:<\/strong> May these model classes ship once the earlier steps are done\?<\/p>/);
  assert.match(allGated.description.split("<hr>")[1], /2 of these wait for the price check or HTPR-7746\. Valentin must then say yes before they ship\./);
  const open = rollupTicket([cheap], new Date("2026-10-25T12:00:00Z"));
  assert.match(open.description.split("<hr>")[1], /Valentin must say yes before these classes can ship\./);
  assert.match(open.description.split("<hr>")[0], /What Valentin must decide:<\/strong> May these model classes ship once the earlier steps are done\?<\/p>/);
  const openai = rollupTicket([{ ...cheap, provider: "openai", model: "openai/gpt-6" }], new Date("2026-10-25T12:00:00Z"));
  assert.match(openai.description.split("<hr>")[0], /What Valentin must decide:<\/strong> May these model classes ship once the earlier steps are done\?<\/p>/);
  assert.match(openai.description.split("<hr>")[1], /Valentin must say yes before these classes can ship\./);
  const gatedOnly = rollupTicket([{ ...cheap, kind: "new-version", provider: "openai", inputPerMillion: 9 }], new Date("2026-10-25T12:00:00Z"));
  assert.match(gatedOnly.description.split("<hr>")[0], /What Valentin must decide:<\/strong> nothing<\/p>/);
  assert.match(gatedOnly.description.split("<hr>")[1], /1 of these wait for the price check or HTPR-7746\. Nothing else; a runner ships the rest\./);
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
