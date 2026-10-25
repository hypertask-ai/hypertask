import assert from "node:assert/strict";
import test from "node:test";
import { resolveInboxFocusScroll } from "../src/lib/inboxFocusScroll";

test("an update that still has the focused row in the list does not move the inbox", () => {
  assert.deepEqual(
    resolveInboxFocusScroll({ keepsScroll: true, focusedRowStillListed: true }),
    { scroll: false, block: "nearest" },
  );
});

test("an update that drops the focused row reveals the next one without centring it", () => {
  assert.deepEqual(
    resolveInboxFocusScroll({ keepsScroll: true, focusedRowStillListed: false }),
    { scroll: true, block: "nearest" },
  );
});

test("the flag off keeps the previous re-centring on every update", () => {
  assert.deepEqual(
    resolveInboxFocusScroll({ keepsScroll: false, focusedRowStillListed: true }),
    { scroll: true, block: "center" },
  );
  assert.deepEqual(
    resolveInboxFocusScroll({ keepsScroll: false, focusedRowStillListed: false }),
    { scroll: true, block: "center" },
  );
});
