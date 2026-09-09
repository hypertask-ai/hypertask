// HTPR-4857: Slack Marketplace readiness. The destructive uninstall path must
// delete installs only for the events that really end them, never a row that
// was reinstalled after the event happened.
import assert from "node:assert/strict";
import test from "node:test";

process.env.BYOK_CIPHER_SECRET = "test-secret-for-slack-uninstall-tests";

import { encryptSecret } from "../src/lib/crypto/byokCipher";
import { parseSafeReturnTo } from "../src/lib/auth/safeReturnTo";
import {
  deleteSlackInstallForRevocation,
  type SlackInstallDb,
  type SlackRevocationEnvelope,
} from "../src/lib/slack/uninstall";

const BOT_TOKEN = "xoxb-test-bot-token";
const MEMBER_TOKEN = "xoxp-member-token";
const INSTALL = {
  id: "install-1",
  botUserId: "B123",
  encryptedBotToken: encryptSecret(BOT_TOKEN),
  updatedAt: new Date("2026-09-09T12:00:00Z"),
};

function fakeDb(install: typeof INSTALL | null) {
  const deleted: Array<Record<string, unknown>> = [];
  const db: SlackInstallDb = {
    slackInstall: {
      async findUnique() {
        return install ? { ...install } : null;
      },
      async deleteMany(args) {
        // Mirror the SQL predicate: only rows matching id + updatedAt cutoff die.
        const cutoff = args.where.updatedAt?.lte;
        if (!install || args.where.id !== install.id) return { count: 0 };
        if (cutoff && install.updatedAt > cutoff) return { count: 0 };
        deleted.push(args.where);
        return { count: 1 };
      },
    },
  };
  return { db, deleted };
}

const envelope = (
  event: SlackRevocationEnvelope["event"],
  teamId = "T1",
): SlackRevocationEnvelope => ({
  team_id: teamId,
  event_time: 1789100000, // after the row's updatedAt (2026-09-09T12:00Z)
  event,
});

test("app_uninstalled deletes the install and cascades", async () => {
  const { db, deleted } = fakeDb(INSTALL);
  const result = await deleteSlackInstallForRevocation(
    db,
    envelope({ type: "app_uninstalled", event_ts: "1789100000.000100" }),
  );
  assert.equal(result, "deleted");
  assert.deepEqual(deleted, [{ id: "install-1", updatedAt: { lte: new Date(1789100000 * 1000) } }]);
});

test("tokens_revoked with the bot token deletes the install", async () => {
  const { db, deleted } = fakeDb(INSTALL);
  const result = await deleteSlackInstallForRevocation(
    db,
    envelope({
      type: "tokens_revoked",
      tokens: { oauth: [MEMBER_TOKEN], bot: [BOT_TOKEN] },
    }),
  );
  assert.equal(result, "deleted");
  assert.deepEqual(deleted, [{ id: "install-1", updatedAt: { lte: new Date(1789100000 * 1000) } }]);
});

test("tokens_revoked listing only member tokens keeps the install", async () => {
  const { db, deleted } = fakeDb(INSTALL);
  const result = await deleteSlackInstallForRevocation(
    db,
    envelope({ type: "tokens_revoked", tokens: { oauth: [MEMBER_TOKEN] } }),
  );
  assert.equal(result, "skipped_not_bot");
  assert.deepEqual(deleted, []);
});

test("tokens_revoked with a foreign bot token keeps the install", async () => {
  const { db, deleted } = fakeDb(INSTALL);
  const result = await deleteSlackInstallForRevocation(
    db,
    envelope({ type: "tokens_revoked", tokens: { bot: ["xoxb-other"] } }),
  );
  assert.equal(result, "skipped_not_bot");
  assert.deepEqual(deleted, []);
});

test("unknown workspace and unrelated event types are no-ops", async () => {
  const { db, deleted } = fakeDb(INSTALL);
  assert.equal(
    await deleteSlackInstallForRevocation(
      fakeDb(null).db,
      envelope({ type: "app_uninstalled" }),
    ),
    "unknown_workspace",
  );
  assert.equal(
    await deleteSlackInstallForRevocation(
      db,
      envelope({ type: "message" }),
    ),
    "skipped_not_bot",
  );
  assert.deepEqual(deleted, []);
});

test("a delayed event never deletes a reinstalled row", async () => {
  const reinstalled = {
    ...INSTALL,
    updatedAt: new Date("2026-09-11T09:00:00Z"), // after event_time
  };
  const { db, deleted } = fakeDb(reinstalled);
  const result = await deleteSlackInstallForRevocation(
    db,
    envelope({ type: "app_uninstalled", event_ts: "1789100000.000100" }),
  );
  assert.equal(result, "skipped_reinstalled");
  assert.deepEqual(deleted, []);
});

test("an install updated later in the event's own second survives", async () => {
  const sameSecond = {
    ...INSTALL,
    updatedAt: new Date(1789100000 * 1000 + 400), // same event second, ms precision
  };
  const { db, deleted } = fakeDb(sameSecond);
  const result = await deleteSlackInstallForRevocation(
    db,
    envelope({ type: "app_uninstalled", event_ts: "1789100000.000100" }),
  );
  assert.equal(result, "skipped_reinstalled");
  assert.deepEqual(deleted, []);
});

test("an event without any timestamp skips deletion", async () => {
  const { db, deleted } = fakeDb(INSTALL);
  const result = await deleteSlackInstallForRevocation(db, {
    team_id: "T1",
    event: { type: "app_uninstalled" },
  });
  assert.equal(result, "skipped_reinstalled");
  assert.deepEqual(deleted, []);
});

test("missing team id is a no-op", async () => {
  const { db, deleted } = fakeDb(INSTALL);
  const result = await deleteSlackInstallForRevocation(db, {
    event: { type: "app_uninstalled" },
  });
  assert.equal(result, "unknown_workspace");
  assert.deepEqual(deleted, []);
});

test("returnTo allows the exact settings slack path and drops its query", () => {
  assert.equal(parseSafeReturnTo("/settings/slack"), "/settings/slack");
  assert.equal(
    parseSafeReturnTo("/settings/slack?slack_error=invalid_state"),
    "/settings/slack",
  );
  assert.equal(parseSafeReturnTo("https://evil.example/settings/slack"), null);
  assert.equal(parseSafeReturnTo("//evil.example"), null);
  // Pre-existing allowlist behavior must not regress.
  assert.equal(parseSafeReturnTo("/settings/slack/link?state=abc"), "/settings/slack/link?state=abc");
  assert.equal(parseSafeReturnTo("/somewhere-else"), null);
});
