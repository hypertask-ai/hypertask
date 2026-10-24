const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/error-secret-redaction.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { redactSecrets, errorFingerprint } = jiti(path.join(root, "src/lib/errors/errorFingerprint.ts"));

const dummyKeys = [
  "sk-proj-DUMMYdummyDUMMYdummy1234",
  "vck_DUMMYdummyDUMMYdummy5678",
  "xai-DUMMYdummyDUMMYdummy90ab",
];

test("now refused: key-shaped values never survive into a reported message", () => {
  for (const key of dummyKeys) {
    const redacted = redactSecrets(`Incorrect API key provided: ${key}. Check your settings.`);
    assert.ok(!redacted.includes(key), redacted);
    assert.match(redacted, /\[redacted\]/);
  }
  assert.equal(redactSecrets("Authorization: Bearer DUMMYdummy.DUMMY-dummy"), "Authorization: [redacted]");
  assert.equal(redactSecrets('{"apiKey":"DUMMYdummy12"}'), '{"apiKey":"[redacted]"}');
  assert.equal(redactSecrets("token=DUMMYdummy12&x=1"), "token=[redacted]&x=1");
  assert.ok(!redactSecrets(`a${"Z".repeat(40)}b`).includes("Z".repeat(40)));
});

test("now refused: two reports differing only by the key share one fingerprint", () => {
  assert.equal(
    errorFingerprint(`Invalid key ${dummyKeys[0]}`, `Error\n    at call (${dummyKeys[1]}:1:1)`),
    errorFingerprint(`Invalid key ${dummyKeys[2]}`, `Error\n    at call (${dummyKeys[0]}:1:1)`),
  );
});

test("still allowed: ordinary error messages and stack frames stay readable", () => {
  for (const message of [
    "Cannot read properties of null (reading '1')",
    "AI Gateway allowance report failed",
    "This team has used its included AI allowance for this month.",
    "Request to /api/ai/task-writer failed with 503 for board 8384",
    "at gatewaySpendBreakdownMicroUsd (src/app/api/ai/_lib/sharedAllowance.ts:331:9)",
    "Missing key in object",
  ]) {
    assert.equal(redactSecrets(message), message);
  }
});

test("still allowed: different errors keep different fingerprints", () => {
  assert.notEqual(
    errorFingerprint("AI Gateway allowance report failed"),
    errorFingerprint("AI Gateway demo allowance report failed"),
  );
});
