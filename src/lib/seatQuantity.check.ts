import assert from "node:assert";
// @ts-expect-error Node strip-types checks require .ts imports without allowImportingTsExtensions.
import { computeSeatQuantity } from "./seatQuantity.ts";

assert.strictEqual(
  computeSeatQuantity({
    totalSeats: 1,
    pendingInviteEmails: ["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"],
    memberEmails: ["owner@x.com"],
  }),
  6,
  "owner + 5 pending invites",
);

assert.strictEqual(
  computeSeatQuantity({
    totalSeats: 1,
    pendingInviteEmails: ["a@x.com", "A@x.com", "b@x.com"],
    memberEmails: ["owner@x.com"],
  }),
  3,
  "dedup pending invites",
);

assert.strictEqual(
  computeSeatQuantity({
    totalSeats: 2,
    pendingInviteEmails: ["member@x.com", "new@x.com"],
    memberEmails: ["owner@x.com", "member@x.com"],
  }),
  3,
  "exclude already-member invites",
);

assert.strictEqual(
  computeSeatQuantity({
    totalSeats: 4,
    pendingInviteEmails: [],
    memberEmails: [],
  }),
  4,
  "no pending invites leaves quantity untouched",
);

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
