import assert from "node:assert/strict";
import test from "node:test";

import {
  recordServerCapture,
  signupAttributionFromHeaders,
} from "../src/lib/telemetry/signupAnalytics";

test("existing first-touch UTM and invite context become signup properties", () => {
  const headers = new Headers({
    cookie:
      "inviteKey=invite-1; projectInvite=project-2; utm_source=first%20newsletter",
  });

  assert.deepEqual(signupAttributionFromHeaders(headers, "google"), {
    signupMethod: "invite",
    utmSource: "first newsletter",
  });
});

test("a PostHog failure is swallowed outside the signup request", async () => {
  const failures: unknown[] = [];
  let scheduled: Promise<unknown> | undefined;

  assert.doesNotThrow(() => {
    recordServerCapture(
      { distinctId: "456", event: "signup_completed", properties: { signup_method: "google" } },
      {
        client: {
          captureImmediate: async () => {
            throw new Error("PostHog unavailable");
          },
        },

        onError: (error) => failures.push(error),
        schedule: (promise) => {
          scheduled = promise;
        },
      },
    );
  });

  await scheduled;
  assert.equal(failures.length, 1);
  assert.match(String(failures[0]), /PostHog unavailable/);
});
