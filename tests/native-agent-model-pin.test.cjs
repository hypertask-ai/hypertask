const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { resolveAgentModelPin, canPinModelOption } = jiti(
  path.join(root, "src/lib/nativeAgent/modelPin.ts"),
);
const { aiModelOptions } = jiti(path.join(root, "src/lib/aiModelOptions.ts"));
const fs = require("node:fs");

const PIN = "gpt-5.6-luna";

test("an agent's pinned model runs its turns", () => {
  // The whole point of pinning: a heartbeat turn names no model, so the agent's
  // own choice has to be what the turn runs on, not the team default.
  assert.equal(
    resolveAgentModelPin({ agentModelOptionId: PIN }),
    PIN,
  );
});

test("a model named in the request beats the pin", () => {
  // Switching model inside the agent's chat must keep working.
  assert.equal(
    resolveAgentModelPin({
      requestedModelOptionId: "claude-opus-5",
      agentModelOptionId: PIN,
    }),
    "claude-opus-5",
  );
  // Naming a raw model is just as explicit as naming an option.
  assert.equal(
    resolveAgentModelPin({
      requestedModel: "gpt-5.6",
      agentModelOptionId: PIN,
    }),
    null,
  );
});

test("an empty model choice is no choice, so the pin still applies", () => {
  // The request schema allows an empty string, and a select whose placeholder
  // is "Team default" sends exactly that. Treated as a real choice it out-ranks
  // the pin and then resolves to nothing, silently billing the team default
  // while the agent's page still shows the pinned model.
  for (const requestedModelOptionId of ["", "   ", null, undefined]) {
    assert.equal(
      resolveAgentModelPin({ requestedModelOptionId, agentModelOptionId: PIN }),
      PIN,
      `empty choice ${JSON.stringify(requestedModelOptionId)} dropped the pin`,
    );
  }
  for (const requestedModel of ["", "  ", null, undefined]) {
    assert.equal(
      resolveAgentModelPin({ requestedModel, agentModelOptionId: PIN }),
      PIN,
    );
  }
});

test("an agent cannot be pinned to the custom endpoint option", () => {
  // "custom" means "whatever endpoint you configured", and an agent has nowhere
  // to configure one, so a pin to it fails every turn while the agent still
  // reads as pinned and healthy.
  assert.equal(canPinModelOption("custom"), false);
  // Every other shipped option stays pinnable, so this guard cannot quietly
  // grow into a denylist that empties the picker.
  const pinnable = aiModelOptions.filter((option) =>
    canPinModelOption(option.id),
  );
  assert.equal(pinnable.length, aiModelOptions.length - 1);
});

test("the write API enforces the pin guard, not just the picker", () => {
  // A picker-only filter is not a rule: the owner can PATCH the API directly.
  const route = fs.readFileSync(
    "src/app/api/agents/[agentId]/route.ts",
    "utf8",
  );
  assert.match(route, /!UNPINNABLE_MODEL_OPTION_IDS\.has\(body\.modelOptionId\)/);
});

test("no agent and no request choice leaves the caller on the default", () => {
  assert.equal(resolveAgentModelPin({}), null);
  assert.equal(resolveAgentModelPin({ agentModelOptionId: "  " }), null);
});
