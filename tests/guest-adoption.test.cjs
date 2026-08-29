// HTPR-4893: adoptGuestBoards runs on every auth chokepoint, including ones that
// fire for users who were never guests. Two mistakes would be expensive:
//   - adopting from a NON-guest previous session hands one real user's boards to
//     another real user (the previous ht_session is only proof of who WAS signed
//     in, not that they consented to a handover);
//   - adopting when guest === target, which really happens: the demo route mints a
//     Better Auth session for the guest itself, running the same hook with both
//     ids equal, and a self-adoption would re-prefix a live guest's uid and strand
//     their session.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const adoptionSource = fs.readFileSync(
  path.join(root, "src/utils/controllers/demo/adoptGuestBoards.ts"),
  "utf8",
);

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

test("adoption remaps guest assignment rows within the adopted projects", () => {
  assert.match(
    adoptionSource,
    /tx\.assignees\.updateMany\(\{[\s\S]*?task: \{ projectId: \{ in: projectIds \} \}[\s\S]*?userId: guestId[\s\S]*?data: \{ userId: targetUserId \}/,
  );
  assert.match(
    adoptionSource,
    /tx\.assignees\.updateMany\(\{[\s\S]*?task: \{ projectId: \{ in: projectIds \} \}[\s\S]*?assignerId: guestId[\s\S]*?data: \{ assignerId: targetUserId \}/,
  );
});
