import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

const root = path.resolve(import.meta.dirname, "..");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")) as {
  crons: { path: string }[];
};

test("probe inbox stores probe-domain mail and reads verification links", async () => {
  const store = new Map<string, { value: string; ttl: number }>();
  const h = activationHarness();
  h.mocks["@/lib/redis"] = {
    getRedis: async () => ({
      set: async (key: string, value: string, _ex: string, ttl: number) => {
        store.set(key, { value, ttl });
      },
      get: async (key: string) => store.get(key)?.value ?? null,
    }),
  };
  const { isProbeRecipientEmail, makeDailyProbeEmail, storeProbeVerificationLink, readProbeInbox } =
    h.load("src/lib/funnelProbe/inbox.ts");
  const built = makeDailyProbeEmail("2026-11-07-abc");
  assert.match(built, /^daily-2026-11-07-abc@funnel-probe\.hypertask\.app$/);
  assert.equal(isProbeRecipientEmail(built), true);
  const email = "daily-test@funnel-probe.hypertask.app";
  await storeProbeVerificationLink(
    email,
    "daily-test",
    "https://app.hypertask.ai/verify-email?token=secret",
  );
  const entry = await readProbeInbox(email);
  assert.equal(entry?.runId, "daily-test");
  assert.match(entry?.verificationUrl ?? "", /verify-email/);
  assert.equal(await readProbeInbox("not-probe@hypertask.ai"), null);
});

test("funnel probe cron and flag are registered", () => {
  assert.ok(vercel.crons.some((cron) => cron.path === "/api/cron/funnel-probe-signup"));
  const def = activationHarness().load("src/lib/flags/definitions/htpr-7294-daily-funnel-probe.ts").default;
  assert.equal(def.key, "htpr-7294-daily-funnel-probe");
  assert.equal(def.defaultMode, "OWNER_AND_QA");
});

test("probe state reports the probe account, its saved steps and its recorded events", async () => {
  const h = activationHarness();
  const probeEmail = "daily-2026-11-10-abc-owner@funnel-probe.hypertask.app";
  const processed = new Date();
  const prisma = {
    user: {
      findFirst: async ({ where }: any) =>
        where.email === probeEmail ? { id: 501, uid: "probe_501", email: probeEmail } : null,
    },
    project: { findFirst: async ({ where }: any) => (where.ownerId === 501 ? { id: 77 } : null) },
    task: { count: async () => 3 },
    member: { count: async () => 1 },
    invite: { count: async () => 1 },
    logs: { count: async ({ where }: any) => (where.log === "cli_token_exchange" ? 1 : 0) },
    analyticsIntent: {
      findMany: async () => [
        { kind: "board_created", payload: { actor: { userId: 501 }, boardId: 77 }, processedAt: processed },
        { kind: "task_created", payload: { taskId: 1, actor: { userId: 501 } }, processedAt: processed },
        { kind: "invite_sent", payload: { inviterUserId: 501 }, processedAt: processed },
        { kind: "board_created", payload: { actor: { userId: 999 } }, processedAt: processed },
        { kind: "task_created", payload: { taskId: 2, actor: { userId: 501 } }, processedAt: null },
      ],
    },
  };
  h.mocks["@/lib/prisma"] = { default: prisma };
  const { readProbeState } = h.load("src/lib/funnelProbe/state.ts");
  const state = await readProbeState(probeEmail);
  assert.equal(state.accountCategory, "probe");
  assert.equal(state.boardId, 77);
  assert.equal(state.taskCount, 3);
  assert.equal(state.pendingInviteCount, 1);
  assert.equal(state.connectionCount, 1);
  assert.deepEqual(state.events.map((event: { kind: string }) => event.kind).sort(), [
    "board_created",
    "invite_sent",
    "task_created",
    "task_created",
  ]);
  assert.deepEqual(state.events.map((event: { processed: boolean }) => event.processed), [true, true, true, false]);
  assert.equal(JSON.stringify(state).includes(probeEmail), false);
  assert.equal(await readProbeState("someone@example.test"), null);
});
