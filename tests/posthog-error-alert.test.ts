import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import Redis from "ioredis";

import {
  claimPostHogAlert,
  commitPostHogAlertClaim,
  parsePostHogExceptionAlert,
} from "../src/lib/telemetry/posthogErrorAlert";
import {
  redactErrorText,
  safeErrorUrl,
} from "../src/lib/telemetry/errorSanitization";

const NOW = Date.parse("2026-09-08T00:00:00.000Z");
const RELEASE = "a".repeat(40);
const FINGERPRINT = "b".repeat(64);
const EVENT_SECRET = "test-event-secret";
const EVENT_ID = "0199aa11-bb22-7c33-8d44-ee5566778899";
process.env.NEXT_PUBLIC_APP_URL = "https://preview.example.test";

function signature(properties: Record<string, unknown>) {
  const exception = (properties.$exception_list as Record<string, unknown>[])[0];
  return createHmac("sha256", EVENT_SECRET)
    .update(
      `${properties.ht_source}\n${properties.ht_environment}\n${properties.ht_release}\n${properties.ht_fingerprint}\n${properties.ht_event_nonce}\n${properties.ht_occurred_at}\n${exception.type}\n${exception.value}`,
    )
    .digest("hex");
}

function webhookPayload(overrides: Record<string, unknown> = {}) {
  const properties: Record<string, unknown> = {
    ht_source: "server",
    ht_environment: "production",
    ht_release: RELEASE,
    ht_fingerprint: FINGERPRINT,
    ht_event_nonce: EVENT_ID,
    ht_occurred_at: "2026-09-08T00:00:00.000Z",
    $exception_list: [{ type: "TypeError", value: "Broken" }],
    ...overrides,
  };
  if (!("ht_event_signature" in overrides)) {
    properties.ht_event_signature = signature(properties);
  }
  return {
    event: {
      event: "$exception",
      uuid: "posthog-event-id-is-not-trusted",
      timestamp: "2026-09-08T00:00:00.000Z",
      properties,
    },
  };
}

test("accepts a fresh signed-server exception shape", () => {
  assert.deepEqual(parsePostHogExceptionAlert(webhookPayload(), EVENT_SECRET, NOW), {
    eventId: "0199aa11-bb22-7c33-8d44-ee5566778899",
    timestamp: "2026-09-08T00:00:00.000Z",
    environment: "production",
    release: RELEASE,
    fingerprint: FINGERPRINT,
    name: "TypeError",
    message: "Broken",
  });
});

test("rejects a browser exception even when it claims a production release", () => {
  assert.equal(
    parsePostHogExceptionAlert(
      webhookPayload({ ht_source: "client" }),
      EVENT_SECRET,
      NOW,
    ),
    undefined,
  );
});

test("rejects a forged server exception from the public PostHog project", () => {
  assert.equal(
    parsePostHogExceptionAlert(
      webhookPayload({ ht_event_signature: "0".repeat(64) }),
      EVENT_SECRET,
      NOW,
    ),
    undefined,
  );
  const modified = webhookPayload();
  (modified.event.properties.$exception_list as Record<string, unknown>[])[0].value =
    "Forged alert text";
  assert.equal(
    parsePostHogExceptionAlert(modified, EVENT_SECRET, NOW),
    undefined,
  );
});

test("rejects stale events and non-commit releases", () => {
  assert.equal(
    parsePostHogExceptionAlert(
      webhookPayload({ ht_release: "latest" }),
      EVENT_SECRET,
      NOW,
    ),
    undefined,
  );
  assert.equal(
    parsePostHogExceptionAlert(
      {
        ...webhookPayload(),
        event: webhookPayload({
          ht_occurred_at: "2026-09-07T23:40:00.000Z",
        }).event,
      },
      EVENT_SECRET,
      NOW,
    ),
    undefined,
  );
});

test("redacts multiline secrets with no key marker after the first line", () => {
  // The markers are assembled at runtime so this source file never contains a
  // contiguous PEM header for gitleaks to flag.
  const begin = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const end = ["-----END", "PRIVATE KEY-----"].join(" ");
  const pem = [
    begin,
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC",
    "second-line-of-key-material",
    "third-line-of-key-material",
    end,
  ].join("\n");
  const multilineQuoted = 'auth failed: {"password": "line-one\nline-two"}';
  const unterminatedPem = [
    "install:",
    ["-----BEGIN", "OPENSSH", "PRIVATE KEY-----"].join(" "),
    "AAAAB3NzaC1yc2EAAAADAQABAAABgQDkey-material",
    "stack frame afterwards",
  ].join("\n");
  const redacted = redactErrorText(
    [pem, multilineQuoted, unterminatedPem].join("\n"),
    4000,
  );
  assert.doesNotMatch(redacted, /MIIE|key-material/);
  assert.doesNotMatch(redacted, /line-one|line-two/);
  assert.doesNotMatch(redacted, /stack frame/);
  assert.match(redacted, /auth failed/);
});

test("redacts full credentials and removes URL queries", () => {
  const dsnUsername = "u".repeat(8);
  const dsnPassword = "p".repeat(16);
  const dsnPasswordWithAt = `${dsnPassword}@suffix`;
  const spacedPassword = ["correct", "horse"].join(" ");
  const dottedToken = ["a".repeat(32), "b".repeat(32), "c".repeat(32)].join(".");
  const input = [
    "Authorization: Basic dXNlcjpwYXNz more",
    "Cookie: session=abc; preference=dark",
    'secret: "two words"',
    "token=plain-token",
    "access_token=access-value refresh_token=refresh-value authToken=auth-value",
    'password="abc\\"def" client_secret="unterminated',
    '{"cookie":"sid=abc","authorization":"Bearer private"}',
    JSON.stringify({ "set-cookie": ["sid=array-secret"] }),
    JSON.stringify(JSON.stringify({ "set-cookie": ["sid=nested-array-secret"] })),
    `postgres://${dsnUsername}:${dsnPassword}@db.example.test/app`,
    `https://${dsnUsername}:${dsnPasswordWithAt}@localhost/path`,
    "cookie=session-value; preference=dark",
    `password=${spacedPassword}`,
    JSON.stringify(JSON.stringify({ password: "nested-private" })),
    '{"token":123456789,"safe":"kept"}',
    "See https://example.test/path?token=url-secret#private-fragment now",
    "owner@example.com",
    `Auth header value: Bearer "${"q".repeat(24)}"`,
    `See https://example.test/reset/${dottedToken} now`,
  ].join("\n");
  const redacted = redactErrorText(input, 2000);

  assert.doesNotMatch(
    redacted,
    /dXNlcjpwYXNz|session=abc|sid=abc|array-secret|nested-array-secret|url-secret|private-fragment|private|preference=dark|two words|plain-token|access-value|refresh-value|auth-value|123456789|abc|def|unterminated|nested-private|owner@example\.com|q{24}/,
  );
  assert.equal(redacted.includes(dottedToken), false);
  assert.match(redacted, /https:\/\/example\.test\/path/);
  assert.equal(redacted.includes(dsnUsername), false);
  assert.equal(redacted.includes(dsnPassword), false);
  assert.equal(redacted.includes("suffix"), false);
  assert.doesNotMatch(redacted, /session-value/);
  assert.equal(redacted.includes(spacedPassword), false);
  assert.doesNotMatch(redacted, /horse/);
  assert.equal(
    safeErrorUrl("https://preview.example.test/task/1?token=secret#private"),
    "https://preview.example.test/task/1",
  );
  const pathWithSecrets = safeErrorUrl(
    `https://preview.example.test/reset/owner@example.com/abcdefghijklmnopqrstuvwxyz123456/${dottedToken}`,
  );
  assert.doesNotMatch(
    pathWithSecrets ? new URL(pathWithSecrets).pathname : "",
    /owner|example|abcdefghijklmnopqrstuvwxyz|aaaaaaaa/,
  );
  assert.equal(safeErrorUrl("http://[malformed"), undefined);
  assert.equal(
    safeErrorUrl("https://private-tenant.example.com/reset/token"),
    undefined,
  );
});

test("uses one atomic Redis claim for event dedupe, rolling count, and spike lock", async () => {
  const calls: unknown[][] = [];
  const redis = {
    async eval(...args: unknown[]) {
      calls.push(args);
      return [1, 21, 0, 1, 0];
    },
  };
  const alert = parsePostHogExceptionAlert(webhookPayload(), EVENT_SECRET, NOW)!;
  const claim = await claimPostHogAlert(redis as never, alert, NOW, "claim-owner");

  assert.deepEqual(claim, {
    accepted: true,
    count: 21,
    firstFingerprint: false,
    ownershipToken: "claim-owner",
    retryable: false,
    spike: true,
  });
  assert.equal(calls.length, 1);
  assert.match(String(calls[0][0]), /ZREMRANGEBYSCORE/);
  assert.match(String(calls[0][0]), /count > tonumber\(ARGV\[6\]\)/);
  assert.equal(calls[0][1], 4);
  assert.equal(calls[0][7], 5 * 60);
});

test("successful dispatches extend only the claims they own", async () => {
  const operations: unknown[][] = [];
  const redis = {
    async eval(...args: unknown[]) {
      operations.push(args);
      return 1;
    },
  };
  const alert = parsePostHogExceptionAlert(webhookPayload(), EVENT_SECRET, NOW)!;

  await commitPostHogAlertClaim(redis as never, alert, {
    accepted: true,
    count: 21,
    firstFingerprint: true,
    ownershipToken: "claim-owner",
    retryable: false,
    spike: false,
  });

  assert.equal(operations.length, 1);
  assert.match(String(operations[0][0]), /GET[\s\S]*EXPIRE/);
  assert.deepEqual(operations[0].slice(1), [
    3,
    `posthog:error-alert:production:${RELEASE}:event:${EVENT_ID}`,
    `posthog:error-alert:production:${RELEASE}:fingerprint:${FINGERPRINT}`,
    `posthog:error-alert:production:${RELEASE}:spike`,
    "claim-owner",
    7 * 24 * 60 * 60,
    1,
    0,
  ]);
});

test("claims exactly one spike after the rolling window exceeds 20 errors", async (t) => {
  if (spawnSync("redis-server", ["--version"]).status !== 0) {
    t.skip("redis-server is not installed");
    return;
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "posthog-alert-"));
  const socket = path.join(directory, "redis.sock");
  const server = spawn("redis-server", [
    "--port",
    "0",
    "--save",
    "",
    "--appendonly",
    "no",
    "--dir",
    directory,
    "--unixsocket",
    socket,
    "--unixsocketperm",
    "700",
  ]);
  const redis = new Redis(socket, { lazyConnect: true, maxRetriesPerRequest: 1 });

  t.after(async () => {
    redis.disconnect();
    server.kill("SIGTERM");
    if (server.exitCode === null) await once(server, "exit");
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const deadline = Date.now() + 5000;
  while (!fs.existsSync(socket)) {
    if (server.exitCode !== null || Date.now() >= deadline) {
      throw new Error("redis-server did not create its socket");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await redis.connect();

  const base = parsePostHogExceptionAlert(webhookPayload(), EVENT_SECRET, NOW)!;
  const claims = [];
  for (let occurrence = 1; occurrence <= 22; occurrence += 1) {
    claims.push(
      await claimPostHogAlert(
        redis,
        {
          ...base,
          eventId: `0199aa11-bb22-7c33-8d44-${String(occurrence).padStart(12, "0")}`,
          timestamp: new Date(NOW + occurrence).toISOString(),
        },
        NOW + occurrence,
      ),
    );
  }

  assert.equal(claims[0].firstFingerprint, true);
  assert.equal(claims[19].spike, false);
  assert.equal(claims[20].count, 21);
  assert.equal(claims[20].spike, true);
  assert.equal(claims[21].count, 22);
  assert.equal(claims[21].spike, false);
  const firstAlert = {
    ...base,
    eventId: "0199aa11-bb22-7c33-8d44-000000000001",
    timestamp: new Date(NOW + 1).toISOString(),
  };
  const inFlightDuplicate = await claimPostHogAlert(
    redis,
    firstAlert,
    NOW + 1,
  );
  assert.equal(inFlightDuplicate.accepted, false);
  assert.equal(inFlightDuplicate.retryable, true);

  await commitPostHogAlertClaim(redis, firstAlert, claims[0]);
  const completedDuplicate = await claimPostHogAlert(
    redis,
    firstAlert,
    NOW + 1,
  );
  assert.equal(completedDuplicate.accepted, false);
  assert.equal(completedDuplicate.retryable, false);

  const nextWindow = await claimPostHogAlert(
    redis,
    { ...base, eventId: "0199aa11-bb22-7c33-8d44-999999999999" },
    NOW + 5 * 60 * 1000 + 100,
  );
  assert.equal(nextWindow.count, 1);
});
