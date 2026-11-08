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
