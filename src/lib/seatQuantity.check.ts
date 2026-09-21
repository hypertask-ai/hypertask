// Runnable check for the HTPR-3777 seat math.
// Run: node --experimental-strip-types src/lib/seatQuantity.check.ts
import assert from "node:assert";
// @ts-ignore -- explicit .ts extension is required by `node --experimental-strip-types`
import { computeSeatQuantity } from "./seatQuantity.ts";

// Onboarding: owner alone (totalSeats=1) invites 5 → bill 6 (owner + 5 invited).
assert.strictEqual(
  computeSeatQuantity({
    totalSeats: 1,
    pendingInviteEmails: ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"],
    memberEmails: ["owner@x.com"],
  }),
  6,
  "owner + 5 pending invites",
);

// Same person invited to two boards counts once (case-insensitive).
assert.strictEqual(
  computeSeatQuantity({
    totalSeats: 1,
    pendingInviteEmails: ["a@x.com", "A@x.com", "b@x.com"],
    memberEmails: ["owner@x.com"],
  }),
  3,
  "dedup pending invites",
);

// Pending invite to someone already on the team is excluded (already in totalSeats).
assert.strictEqual(
  computeSeatQuantity({
    totalSeats: 2,
    pendingInviteEmails: ["member@x.com", "new@x.com"],
    memberEmails: ["owner@x.com", "member@x.com"],
  }),
  3,
  "exclude already-member invites",
);

// Existing upgrade, no pending invites → unchanged (no regression).
assert.strictEqual(
  computeSeatQuantity({
    totalSeats: 4,
    pendingInviteEmails: [],
    memberEmails: [],
  }),
  4,
  "no pending invites leaves quantity untouched",
);

// Null/undefined invitee emails (e.g. malformed rows) are ignored, not counted.
assert.strictEqual(
  computeSeatQuantity({
    totalSeats: 1,
    pendingInviteEmails: [null, undefined, "a@x.com"],
    memberEmails: [],
  }),
  2,
  "null invitee emails ignored",
);

console.log("seatQuantity: all checks passed");
