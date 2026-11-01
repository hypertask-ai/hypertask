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

const PIN = "gpt-5.6-luna";

test("an agent's pinned model runs its turns", () => {
  assert.equal(
    resolveAgentModelPin({ agentModelOptionId: PIN }),
    PIN,
  );
});

test("a model named in the request beats the pin", () => {
  assert.equal(
    resolveAgentModelPin({
      requestedModelOptionId: "claude-opus-5-5-thinking",
      agentModelOptionId: PIN,
    }),
    "claude-opus-5-5-thinking",
  );
  assert.equal(
    resolveAgentModelPin({
      requestedModel: "gpt-5.6",
      agentModelOptionId: PIN,
    }),
    null,
  );
});

test("an empty model choice is no choice, so the pin still applies", () => {
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
  assert.equal(canPinModelOption("custom"), false);
  const pinnable = aiModelOptions.filter((option) =>
    canPinModelOption(option.id),
  );
  assert.equal(pinnable.length, aiModelOptions.length - 1);
});

test("no agent and no request choice leaves the caller on the default", () => {
  assert.equal(resolveAgentModelPin({}), null);
  assert.equal(resolveAgentModelPin({ agentModelOptionId: "  " }), null);
});
