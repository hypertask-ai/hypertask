const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

test("the skill offer flag ships at Owner and QA with a rollback reason", () => {
  const { definitions } = require("./helpers/flag-files.cjs");
  const definition = definitions().find((flag) => flag.key === "htpr-7779-skill-offers");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.kind, "feature");
  assert.match(definition.releaseRisk.reason, /Off hides the card/);
});

test("the card is only built from the person's own offer link", () => {
  const contract = load("src/lib/ai/skillOffers/contract.ts");
  const id = "6d1f2c8e-3b4a-4f2e-9c1d-2a5b7e9f0c33";
  const ids = contract.extractSkillOfferIds(`<p>Done.</p>${contract.skillOfferLink(id)}`).ids;
  assert.deepEqual(ids, [id]);
});

test("the draft handoff sends one chat message naming the rule", () => {
  const client = load("src/lib/ai/skillOffers/client.ts");
  const message = client.skillOfferDraftMessage("Put the ticket id next to the title.");
  assert.match(message, /Put the ticket id next to the title\./);
  assert.match(message, /wait for my approval/);
});
