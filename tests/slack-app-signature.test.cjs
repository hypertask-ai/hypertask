const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { loadTs } = require("./slack-app-fixtures.cjs");

const { verifySlackSignature } = loadTs("src/lib/slack/signature.ts");
const secret = "test-signing-secret";
const now = 1_800_000_000_000;
function sign(body, timestamp) {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

test("signature authenticates the exact raw body and accepts only the five-minute window", () => {
  const body = "command=%2Fht&text=create+Task";
  for (const age of [-300, 0, 300]) {
    const timestamp = String(now / 1000 + age);
    assert.equal(verifySlackSignature(body, sign(body, timestamp), timestamp, secret, now), true);
  }
  for (const age of [-301, 301]) {
    const timestamp = String(now / 1000 + age);
    assert.equal(verifySlackSignature(body, sign(body, timestamp), timestamp, secret, now), false);
  }
  const timestamp = String(now / 1000);
  assert.equal(verifySlackSignature(`${body}x`, sign(body, timestamp), timestamp, secret, now), false);
  assert.equal(verifySlackSignature(body, sign(body, timestamp), timestamp, "wrong", now), false);
  assert.equal(verifySlackSignature(body, sign(body, timestamp), timestamp, undefined, now), false);
});

test("malformed headers are rejected even when their noncanonical timestamp was signed", () => {
  for (const timestamp of ["", " ", "1800000000.0", "1.8e9", "+1800000000", " 1800000000", "NaN", "Infinity", null]) {
    assert.equal(verifySlackSignature("{}", sign("{}", timestamp), timestamp, secret, now), false);
  }
  for (const signature of [null, "", "v1=" + "a".repeat(64), "v0=a", "v0=" + "g".repeat(64), "v0=" + "a".repeat(65)]) {
    assert.equal(verifySlackSignature("{}", signature, String(now / 1000), secret, now), false);
  }
});

for (const endpoint of ["commands", "events"]) {
  test(`${endpoint} rejects unsigned requests before any lookup or background action`, async () => {
    const { POST } = loadTs(`src/app/api/slack/${endpoint}/route.ts`, {
      "@vercel/functions": { waitUntil: () => assert.fail("unauthorized background work") },
      "@/lib/slack/commandHandler": { handleSlackCommand: () => assert.fail("unauthorized command") },
      "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => "https://app.hypertask.ai" },
      "@/lib/slack/assistant": {},
      "@/lib/slack/uninstall": {},
    });
    const body = endpoint === "events" ? JSON.stringify({ type: "url_verification", challenge: "challenge" }) : "command=%2Fht";
    const response = await POST(new Request(`https://app.hypertask.ai/api/slack/${endpoint}`, { method: "POST", body }));
    assert.equal(response.status, 401);
  });
}

test("signed slash requests acknowledge once and retries cannot repeat an action", async () => {
  const previousSecret = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = secret;
  try {
    const work = [], calls = [], receipts = new Set();
    const { POST } = loadTs("src/app/api/slack/commands/route.ts", {
      "@/lib/prisma": { __esModule: true, default: {} },
      "@vercel/functions": { waitUntil: (promise) => work.push(promise) },
      "@/lib/slack/commandHandler": { handleSlackCommand: async (...args) => calls.push(args) },
      "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => "https://app.hypertask.ai" },
      "@/lib/slack/taskCreateIntent": { claimSlackEventOnce: async (_db, id) => { if (receipts.has(id)) return false; receipts.add(id); return true; } },
    });
    const body = new URLSearchParams({ command: "/ht", text: "list", response_url: "https://hooks.slack.com/test", team_id: "T1", user_id: "U1", channel_id: "C1", trigger_id: "trigger-1" }).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    for (let index = 0; index < 2; index++) {
      const response = await POST(new Request("https://untrusted.example/api/slack/commands", {
        method: "POST", body,
        headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": sign(body, timestamp) },
      }));
      assert.equal(response.status, 200);
      await Promise.all(work.splice(0));
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].slackUserId, "U1");
    assert.equal(calls[0][1], "https://app.hypertask.ai");
  } finally {
    if (previousSecret === undefined) delete process.env.SLACK_SIGNING_SECRET;
    else process.env.SLACK_SIGNING_SECRET = previousSecret;
  }
});

test("the signed URL verification challenge works and a signed malformed JSON is rejected", async () => {
  const previousSecret = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = secret;
  try {
    const { POST } = loadTs("src/app/api/slack/events/route.ts", {
      "@vercel/functions": { waitUntil: () => assert.fail("challenge background work") },
      "@/lib/slack/assistant": {},
      "@/lib/slack/uninstall": {},
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    for (const [body, expectedStatus] of [[JSON.stringify({ type: "url_verification", challenge: "hello" }), 200], ["{bad", 400]]) {
      const response = await POST(new Request("https://app.hypertask.ai/api/slack/events", {
        method: "POST", body,
        headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": sign(body, timestamp) },
      }));
      assert.equal(response.status, expectedStatus);
      if (expectedStatus === 200) assert.deepEqual(await response.json(), { challenge: "hello" });
    }
  } finally {
    if (previousSecret === undefined) delete process.env.SLACK_SIGNING_SECRET;
    else process.env.SLACK_SIGNING_SECRET = previousSecret;
  }
});
