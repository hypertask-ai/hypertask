const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, "tests/guest-adoption-jiti.cjs"),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    }
  );
  return jiti(path.join(root, relativePath));
}

const telemetryPath = path.join(root, "src/lib/telemetry/activationOccurrences.ts");
require.cache[telemetryPath] = { id: telemetryPath, filename: telemetryPath, loaded: true, exports: { captureActivationOccurrence: async () => null } };

const { shouldAdoptGuest } = loadTs(
  "src/utils/controllers/demo/adoptGuestBoards.ts"
);

test("an anonymous guest hands their boards to the new account", () => {
  assert.equal(shouldAdoptGuest({ id: 900, uid: "guest_abc" }, 6), true);
});

test("a real user's session is never treated as a guest handover", () => {
  assert.equal(shouldAdoptGuest({ id: 900, uid: "email_abc" }, 6), false);
  assert.equal(shouldAdoptGuest({ id: 900, uid: null }, 6), false);
  assert.equal(shouldAdoptGuest({ id: 900 }, 6), false);
});

test("a guest never adopts from itself", () => {
  assert.equal(shouldAdoptGuest({ id: 900, uid: "guest_abc" }, 900), false);
});

test("an already-adopted guest is not adopted twice", () => {
  assert.equal(shouldAdoptGuest({ id: 900, uid: "exguest_abc" }, 6), false);
});

test("no previous user means nothing to adopt", () => {
  assert.equal(shouldAdoptGuest(null, 6), false);
  assert.equal(shouldAdoptGuest(undefined, 6), false);
});

test("an unresolved target id is refused", () => {
  assert.equal(shouldAdoptGuest({ id: 900, uid: "guest_abc" }, NaN), false);
});
