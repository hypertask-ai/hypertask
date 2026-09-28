import assert from "node:assert/strict";
import test from "node:test";

import {
  recordUserSignedUp,
  signupAttributionFromHeaders,
} from "../src/lib/telemetry/signupAnalytics";

test("a new account captures user_signed_up once with approved properties", async () => {
  const captures: unknown[] = [];
  let scheduled: Promise<unknown> | undefined;

  recordUserSignedUp(
    {
      isNewUser: true,
      userId: 123,
      signupMethod: "invite",
      utmSource: "newsletter",
    },
    {
      client: {
        captureImmediate: async (capture) => {
          captures.push(capture);
        },
      },
      schedule: (promise) => {
        scheduled = promise;
      },
    },
  );

  await scheduled;
  assert.deepEqual(captures, [
    {
      distinctId: "123",
      event: "user_signed_up",
      properties: {
        signup_method: "invite",
        utm_source: "newsletter",
      },
    },
  ]);
});

test("an existing-user login does not capture a signup", () => {
  let captures = 0;

  recordUserSignedUp(
    {
      isNewUser: false,
      userId: 123,
      signupMethod: "email",
    },
    {
      client: {
        captureImmediate: async () => {
          captures += 1;
        },
      },
      schedule: () => {
        throw new Error("existing logins must not schedule analytics");
      },
    },
  );

  assert.equal(captures, 0);
});

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
    recordUserSignedUp(
      {
        isNewUser: true,
        userId: 456,
        signupMethod: "google",
      },
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
