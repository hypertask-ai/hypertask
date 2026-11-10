import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

function probeHarness() {
  const h = activationHarness();
  const counters = new Map<string, number>();
  h.mocks["@/lib/redis"] = {
    getRedis: async () => ({
      incr: async (key: string) => (counters.set(key, (counters.get(key) ?? 0) + 1), counters.get(key)!),
      decr: async (key: string) => (counters.set(key, Math.max(0, (counters.get(key) ?? 0) - 1)), counters.get(key)!),
      expire: async () => 1,
    }),
  };
  h.mocks["@/lib/cronAuthorization"] = {
    hasValidCronAuthorization: (auth: string | null | undefined, secret: string | undefined) =>
      Boolean(secret && auth === `Bearer ${secret}`),
  };
  return { h, counters };
}

test("stranger probe instant signup is forbidden", async () => {
  const { h, counters } = probeHarness();
  const { gateProbeInstantSignup } = h.load("src/lib/funnelProbe/signupGuard.ts");
  const gate = await gateProbeInstantSignup(
    null,
    "attacker-1@funnel-probe.hypertask.app",
    "probe-test-secret",
  );
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.equal(gate.status, 403);
    assert.equal(gate.code, "PROBE_SIGNUP_FORBIDDEN");
  }
  assert.equal(counters.size, 0);
});

test("probe signup hourly limit is shared across emails", async () => {
  const { h } = probeHarness();
  process.env.CRON_SECRET = "probe-test-secret";
  process.env.FUNNEL_PROBE_SIGNUPS_PER_HOUR = "2";
  const { gateProbeInstantSignup, probeSignupHourlyLimit } = h.load("src/lib/funnelProbe/signupGuard.ts");
  assert.equal(probeSignupHourlyLimit(), 2);
  const auth = "Bearer probe-test-secret";
  const first = await gateProbeInstantSignup(auth, "daily-a@funnel-probe.hypertask.app", process.env.CRON_SECRET);
  const second = await gateProbeInstantSignup(auth, "daily-b@funnel-probe.hypertask.app", process.env.CRON_SECRET);
  const third = await gateProbeInstantSignup(auth, "daily-c@funnel-probe.hypertask.app", process.env.CRON_SECRET);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  if (!third.ok) {
    assert.equal(third.status, 429);
    assert.equal(third.code, "PROBE_SIGNUP_HOURLY_LIMIT");
  }
});

test("funnel probe daily script sends cron auth on instant signup", () => {
  const script = fs.readFileSync(
    path.join(import.meta.dirname, "../.github/scripts/funnel-probe-daily.mjs"),
    "utf8",
  );
  assert.match(script, /instant-signup[\s\S]*Authorization.*INBOX_SECRET/);
});
