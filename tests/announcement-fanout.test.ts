import assert from "node:assert/strict";
import test from "node:test";

import {
  announcementIsWelcome,
  userBatches,
} from "../src/lib/announcements/fanout";

test("announcementIsWelcome only reads the new user flag", () => {
  assert.equal(announcementIsWelcome({ newUserMark: true }), true);
  assert.equal(announcementIsWelcome({ title: "Latest" }), false);
  assert.equal(announcementIsWelcome(null), false);
  assert.equal(announcementIsWelcome(undefined), false);
});

test("userBatches splits recipients without losing anyone", () => {
  assert.deepEqual(userBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(userBatches([], 3), []);
  assert.deepEqual(userBatches([7, 8], 40), [[7, 8]]);
});
