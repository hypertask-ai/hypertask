const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { Webhook } = require("svix");

const root = path.resolve(__dirname, "..");

function loadTs(relativePath) {
  const jiti = require("jiti")(path.join(root, "tests/svix-webhook-jiti.cjs"), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  return jiti(path.join(root, relativePath));
}

const secret = `whsec_${Buffer.from("htpr6420-svix-verify-key").toString("base64")}`;
const payload = {
  type: "email.received",
  data: {
    email_id: "email_test",
    from: "a@example.com",
    to: ["b@example.com"],
  },
};

function signedHeaders(rawBody) {
  const webhook = new Webhook(secret);
  const msgId = "msg_htpr6420";
  const timestamp = new Date();
  return {
    "svix-id": msgId,
    "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "svix-signature": webhook.sign(msgId, timestamp, rawBody),
  };
}

test("svix 2.x verify then parse returns the signed event", () => {
  const { verifySvixPayload } = loadTs("src/lib/svixWebhook.ts");
  const rawBody = JSON.stringify(payload);
  assert.deepEqual(verifySvixPayload(secret, rawBody, signedHeaders(rawBody)), payload);
});

test("a bad signature is rejected before the body is trusted", () => {
  const { verifySvixPayload } = loadTs("src/lib/svixWebhook.ts");
  const rawBody = JSON.stringify(payload);
  const headers = signedHeaders(rawBody);
  headers["svix-signature"] = "v1,deadbeef";
  assert.throws(() => verifySvixPayload(secret, rawBody, headers));
});
