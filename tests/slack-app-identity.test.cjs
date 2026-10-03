const test = require("node:test");
const assert = require("node:assert/strict");
const { actor, loadTs, memoryRedis } = require("./slack-app-fixtures.cjs");

function identityFixture(options = {}) {
  const writes = [];
  const redis = memoryRedis();
  const teamUser = { ...actor.user, emailVerified: true };
  const prisma = {
    slackInstall: {
      findUnique: async ({ where }) => where.slackTeamId === "T1" ? {
        ...actor, id: actor.installId, encryptedBotToken: "test-ciphertext", installedByUserId: 6,
        team: { aiProviderSettings: {} }, userLinks: options.linked ? [{ user: options.linked }] : [],
      } : null,
      findFirst: async ({ where }) => {
        assert.equal(where.id, actor.installId);
        assert.equal(where.team.OR[1].members.some.status, "Accepted");
        const id = where.team.OR[0].googleAccount.is.userId;
        return (options.allowedIds ?? [42, 6]).includes(id) ? { id: actor.installId } : null;
      },
    },
    team: { findUnique: async ({ where }) => {
      assert.equal(where.id, actor.teamId);
      return { googleAccount: { userId: 6 }, members: [{ user: { ...teamUser, ...options.teamUser } }] };
    } },
    user: { findUnique: async () => ({ id: 6, email: "owner@example.com", emailVerified: true }) },
    slackUserLink: {
      create: async ({ data }) => { writes.push(data); if (options.collision) throw { code: "P2002" }; return { user: teamUser }; },
      findUnique: async () => ({ user: options.collisionUser ?? actor.user }),
      deleteMany: async (args) => writes.push({ deleted: args.where }),
    },
  };
  const loaded = loadTs("src/lib/slack/userLink.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/crypto/byokCipher": { decryptSecret: () => actor.botToken },
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/flags": { HTPR_6817_SLACK_APP_FLAG: "htpr-6817-slack-app", isFeatureEnabled: async () => options.enabled !== false },
    "@/lib/slack/api": { callSlackApi: async (method, _token, params) => {
      assert.equal(method, "users.info"); assert.equal(params.user, "U1");
      return { ok: true, user: { is_email_confirmed: true, profile: { email: " PERSON@EXAMPLE.COM " }, ...options.slackUser } };
    } },
  });
  return { ...loaded, redis, writes };
}

test("auto-match uses a confirmed Slack email and exactly one verified installing-team member", async () => {
  const fixture = identityFixture();
  const result = await fixture.resolveSlackActor("T1", "U1");
  assert.equal(result.user.id, actor.user.id);
  assert.equal(result.teamId, actor.teamId);
  assert.deepEqual(fixture.writes, [{ installId: actor.installId, slackUserId: actor.slackUserId, userId: actor.user.id }]);
  assert.equal(await fixture.resolveSlackActor("FOREIGN", "U1"), null);
});

for (const [name, options] of [
  ["no match", { slackUser: { profile: { email: "outsider@example.com" } } }],
  ["unconfirmed Slack email", { slackUser: { is_email_confirmed: false } }],
  ["unverified Hypertask email", { teamUser: { emailVerified: false, UserSetting: { isVerified: false } } }],
  ["deleted Slack user", { slackUser: { deleted: true } }],
  ["Slack bot", { slackUser: { is_bot: true } }],
]) {
  test(`${name} gets a connect prompt and cannot perform an action`, async () => {
    const fixture = identityFixture(options);
    const result = await fixture.resolveSlackActor("T1", "U1");
    assert.equal(result, null);
    assert.deepEqual(fixture.writes, []);
    const { runAsLinkedSlackUser } = loadTs("src/lib/slack/authorization.ts");
    const authorization = await runAsLinkedSlackUser(result, () => assert.fail("unauthorized action"));
    assert.match(JSON.stringify(authorization.blocks), /\/ht connect/);
  });
}

test("ambiguous verified matches are never linked", () => {
  const { selectConfirmedUniqueTeamMember } = identityFixture();
  assert.equal(selectConfirmedUniqueTeamMember({ is_email_confirmed: true, profile: { email: actor.user.email } }, [
    { id: 42, email: actor.user.email, verified: true },
    { id: 43, email: actor.user.email.toUpperCase(), verified: true },
  ]), null);
});

test("stale links are removed and a concurrent link cannot escape the installing team", async () => {
  const stale = identityFixture({ linked: { ...actor.user, id: 99 }, allowedIds: [] });
  assert.equal(await stale.resolveSlackActor("T1", "U1"), null);
  assert.ok(stale.writes.some((write) => write.deleted));
  const concurrent = identityFixture({ collision: true, collisionUser: { ...actor.user, id: 99 } });
  assert.equal(await concurrent.resolveSlackActor("T1", "U1"), null);
});

test("disconnect suppression lasts until explicit connect, and flag off leaves legacy mapping unchanged", async () => {
  const fixture = identityFixture();
  await fixture.setSlackAutoLinkDisabled(actor.installId, "U1", true);
  assert.equal(await fixture.resolveSlackActor("T1", "U1"), null);
  assert.equal(fixture.writes.length, 0);
  await fixture.setSlackAutoLinkDisabled(actor.installId, "U1", false);
  assert.equal((await fixture.resolveSlackActor("T1", "U1")).user.id, 42);
  const legacy = identityFixture({ enabled: false });
  await legacy.setSlackAutoLinkDisabled(actor.installId, "U1", true);
  assert.equal((await legacy.resolveSlackActor("T1", "U1")).user.id, 42);
});

test("connect fallback issues a signed user-bound link and confirmation refuses another Slack member", async () => {
  const previous = process.env.SLACK_CLIENT_SECRET;
  process.env.SLACK_CLIENT_SECRET = "test-client-secret";
  try {
    const responses = [];
    const { createSlackLinkConfirmation, verifySlackLinkState } = loadTs("src/lib/slack/linkState.ts");
    const { handleSlackCommand } = loadTs("src/lib/slack/commandHandler.ts", {
      "@/lib/prisma": { __esModule: true, default: { slackInstall: { findUnique: async () => ({ id: actor.installId }), findFirst: async () => ({ id: actor.installId }) } } },
      "@/lib/slack/actions": { executeSlackAction: () => assert.fail("connect executed task action") },
      "@/lib/slack/userLink": { resolveSlackActor: async () => null, isSlackInstallTeamMember: async () => true },
      "@/lib/slack/rateLimit": { claimSlackActionCapacity: async () => true },
      "@/lib/slack/api": { postSlackResponseUrl: async (...args) => responses.push(args) },
    });
    const payload = { channelId: "C1", responseUrl: "https://hooks.slack.com/test", slackTeamId: "T1", slackUserId: "U1", text: "connect" };
    await handleSlackCommand(payload, "https://app.hypertask.ai");
    const url = new URL(responses[0][1].find((block) => block.type === "actions").elements[0].url);
    assert.equal(url.origin, "https://app.hypertask.ai");
    const state = verifySlackLinkState(url.searchParams.get("state"), process.env.SLACK_CLIENT_SECRET);
    assert.equal(state.slackUserId, "U1");
    assert.equal(state.installId, actor.installId);
    const token = createSlackLinkConfirmation({ installId: actor.installId, slackUserId: "OTHER", userId: 42 }, process.env.SLACK_CLIENT_SECRET);
    await handleSlackCommand({ ...payload, text: `connect ${token}` }, "https://app.hypertask.ai");
    assert.match(JSON.stringify(responses[1]), /different Slack account/);
  } finally {
    if (previous === undefined) delete process.env.SLACK_CLIENT_SECRET;
    else process.env.SLACK_CLIENT_SECRET = previous;
  }
});
