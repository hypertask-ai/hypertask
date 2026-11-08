import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { activationHarness } from "./helpers/activation-harness";
import { load } from "./task-route-loader.cjs";

const root = path.resolve(import.meta.dirname, "..");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")) as {
  crons: { path: string }[];
};

test("probe recipient detection accepts daily addresses on the probe domain", () => {
  const { isProbeRecipientEmail, makeDailyProbeEmail } = activationHarness().load(
    "src/lib/funnelProbe/probeEmail.ts",
  );
  const email = makeDailyProbeEmail("2026-11-07-abc");
  assert.match(email, /^daily-2026-11-07-abc@funnel-probe\.hypertask\.app$/);
  assert.equal(isProbeRecipientEmail(email), true);
});

test("probe inbox stores and reads verification links only for probe mail", async () => {
  const store = new Map<string, { value: string; ttl: number }>();
  const h = activationHarness();
  h.setFlagEnabled("htpr-7294-daily-funnel-probe", true);
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

test("funnel probe cron and flag are registered", () => {
  assert.ok(vercel.crons.some((cron) => cron.path === "/api/cron/funnel-probe-signup"));
  const def = activationHarness().load("src/lib/flags/definitions/htpr-7294-daily-funnel-probe.ts").default;
  assert.equal(def.key, "htpr-7294-daily-funnel-probe");
  assert.equal(def.defaultMode, "OWNER_AND_QA");
});

test("ops funnel-probe-inbox requires cron secret and returns probe entries", async () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "probe-inbox-test-secret";
  const probeEmail = "daily-test@funnel-probe.hypertask.app";
  const entry = {
    runId: "daily-test",
    verificationUrl: "https://app.hypertask.ai/verify-email?token=fixture",
    storedAt: "2026-11-08T00:00:00.000Z",
  };
  try {
    const route = load("src/app/api/ops/funnel-probe-inbox/route.ts", {
      "@/lib/flags": {
        FEATURE_FLAG_OWNER_USER_ID: 6,
        isFeatureEnabled: async () => true,
      },
      "@/lib/funnelProbe/inbox": {
        readProbeInbox: async (email: string) => (email === probeEmail ? entry : null),
      },
    });
    const denied = await route.GET(
      new NextRequest(`https://app.hypertask.ai/api/ops/funnel-probe-inbox?email=${encodeURIComponent(probeEmail)}`),
    );
    assert.equal(denied.status, 401);
    const allowed = await route.GET(
      new NextRequest(
        `https://app.hypertask.ai/api/ops/funnel-probe-inbox?email=${encodeURIComponent(probeEmail)}`,
        { headers: { authorization: "Bearer probe-inbox-test-secret" } },
      ),
    );
    assert.equal(allowed.status, 200);
    const body = (await allowed.json()) as { found: boolean; entry: typeof entry };
    assert.equal(body.found, true);
    assert.equal(body.entry.runId, entry.runId);
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
});
