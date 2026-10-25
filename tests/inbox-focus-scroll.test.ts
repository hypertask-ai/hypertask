import assert from "node:assert/strict";
import test from "node:test";
import { resolveInboxFocusScroll } from "../src/lib/inboxFocusScroll";

const focusStayed = {
  keepsScroll: true,
  focusedNotificationId: "42",
  previousFocusedNotificationId: "42",
  hasFocusedRow: true,
};

test("an update that leaves the focused row in place does not move the list", () => {
  assert.deepEqual(resolveInboxFocusScroll(focusStayed), {
    scroll: false,
    block: "nearest",
  });
});

test("an update that changes the focused row reveals it without centring it", () => {
  assert.deepEqual(
    resolveInboxFocusScroll({
      ...focusStayed,
      previousFocusedNotificationId: "41",
    }),
    { scroll: true, block: "nearest" },
  );
});

test("a first render with a focused row reveals it without centring it", () => {
  assert.deepEqual(
    resolveInboxFocusScroll({
      ...focusStayed,
      previousFocusedNotificationId: null,
    }),
    { scroll: true, block: "nearest" },
  );
});

test("an update that removes the focused row falls back to revealing its split", () => {
  assert.deepEqual(
    resolveInboxFocusScroll({ ...focusStayed, hasFocusedRow: false }),
    { scroll: true, block: "nearest" },
  );
});

test("the flag off keeps the previous re-centring on every update", () => {
  assert.deepEqual(resolveInboxFocusScroll({ ...focusStayed, keepsScroll: false }), {
    scroll: true,
    block: "center",
  });
  assert.deepEqual(
    resolveInboxFocusScroll({
      keepsScroll: false,
      focusedNotificationId: "42",
      previousFocusedNotificationId: "41",
      hasFocusedRow: true,
    }),
    { scroll: true, block: "center" },
  );
});
