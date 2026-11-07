import assert from "node:assert/strict";
import test from "node:test";
import vercel from "../vercel.json" with { type: "json" };
import { activationHarness } from "./helpers/activation-harness";

test("probe recipient detection accepts daily addresses on the probe domain", () => {
  const { isProbeRecipientEmail, makeDailyProbeEmail } = activationHarness().load(
    "src/lib/funnelProbe/probeEmail.ts",
  );
  const email = makeDailyProbeEmail("2026-11-07-abc");
  assert.match(email, /^daily-2026-11-07-abc@funnel-probe\.hypertask\.app$/);
  assert.equal(isProbeRecipientEmail(email), true);
  assert.equal(
    isProbeRecipientEmail("daily@funnel-probe.hypertask.app.evil.com"),
    false,
  );
});

test("probe inbox stores and reads verification links only for probe mail", async () => {
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
  const { storeProbeVerificationLink, readProbeInbox, redactProbeInboxForAlert } =
    h.load("src/lib/funnelProbe/inbox.ts");
  const email = "daily-test@funnel-probe.hypertask.app";
  await storeProbeVerificationLink(
    email,
    "daily-test",
    "https://app.hypertask.ai/verify-email?token=secret",
  );
  const entry = await readProbeInbox(email);
  assert.equal(entry?.runId, "daily-test");
  assert.match(entry?.verificationUrl ?? "", /verify-email/);
  assert.equal(redactProbeInboxForAlert(entry)?.hasVerificationLink, true);
  assert.equal(await readProbeInbox("not-probe@hypertask.ai"), null);
});

test("funnel probe cron route is registered in vercel.json", () => {
  assert.ok(
    vercel.crons.some((cron) => cron.path === "/api/cron/funnel-probe-signup"),
  );
});
