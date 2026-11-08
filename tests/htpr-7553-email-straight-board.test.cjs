const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const guard = ({ user, fail = false } = {}) => loadModule("src/lib/auth/unverifiedEmailAccount.ts", {
  "@/lib/prisma": { default: { user: { findUnique: async () => {
    if (fail) throw new Error("database unavailable");
    return user;
  } } } },
}).unverifiedEmailAccount;
test("an account outside this signup flow stays allowed", async () => {
  assert.equal(await guard({ user: { uid: "email_test", emailVerified: false, UserSetting: { isVerified: false } } })(7), "allowed");
});
test("a straight-board signup is blocked until confirmed and confirmed accounts pass", async () => {
  const blocked = await guard({ user: { uid: "email_sb_1", emailVerified: false, UserSetting: { isVerified: false } } })(7);
  const verified = await guard({ user: { uid: "email_sb_2", emailVerified: true, UserSetting: null } })(7);
  assert.equal(blocked, "blocked");
  assert.equal(verified, "allowed");
});
test("an unreadable verification state is never reported as allowed", async () => {
  assert.equal(await guard({ fail: true })(7), "unknown");
});
