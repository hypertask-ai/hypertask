const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/loadModule.cjs");

const guard = ({ user, fail = false } = {}) => loadModule("src/lib/auth/unverifiedEmailAccount.ts", {
  "@/lib/prisma": { default: { user: { findUnique: async () => { if (fail) throw new Error("database unavailable"); return user; } } } },
}).unverifiedEmailAccount;
test("a straight-board signup is blocked until confirmed and confirmed accounts pass", async () => {
  const blocked = await guard({ user: { uid: "email_sb_1", emailVerified: false, UserSetting: { isVerified: false } } })(7);
  const verified = await guard({ user: { uid: "email_sb_2", emailVerified: true, UserSetting: null } })(7);
  assert.equal(blocked, "blocked");
  assert.equal(verified, "allowed");
});
test("an unreadable verification state is never reported as allowed", async () => {
  assert.equal(await guard({ fail: true })(7), "unknown");
});

const inviteGuard = (state) => loadModule("src/utils/api/invite/generatePublicInviteController.ts", {
  "@/lib/prisma": { default: {
    user: { findUnique: async () => state.account },
    project: { findUnique: async () => { state.reads += 1; return state.project } },
    invite: { findFirst: async () => state.invite },
  } },
  "@/pages/api/invite/createInviteLink": { generateInviteLink: async () => "https://invite.test/1", setViewSlug: () => undefined },
  "@/utils/controllers/projects/getAll": { getProjectViewInclude: () => ({}) },
  "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getViewFromProject: () => undefined },
  "@/lib/telemetry/analyticsIntents": { processAnalyticsIntentSoon: () => {} },
  "@/lib/telemetry/inviteAnalytics": { enqueueInviteSent: async () => null },
});
test("an unconfirmed straight-board account gets no invite link and a confirmed one does", async () => {
  const blocked = { account: { uid: "email_sb_1", emailVerified: false, UserSetting: { isVerified: false } }, reads: 0, project: null, invite: null };
  assert.equal(await inviteGuard(blocked).getInviteFromProjectId(20, 7), undefined);
  assert.equal(blocked.reads, 0);
  const allowed = { account: { uid: "email_sb_2", emailVerified: true, UserSetting: null }, reads: 0, project: { id: 20, project_view: {} }, invite: { id: "i1", uses: -1, project: { name: "Board" } } };
  assert.deepEqual(await inviteGuard(allowed).getInviteFromProjectId(20, 7), { inviteLink: "https://invite.test/1", amountUsed: 0 });
  assert.equal(allowed.reads, 1);
});
