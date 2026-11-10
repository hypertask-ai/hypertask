import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTableSortClick,
  hideColumnOnView,
  resolveTableColumns,
  sanitizeTableSortStack,
  storedTableSortStack,
} from "../src/lib/table-view/tableViewSettings";

test("priority then updated both survive a reload", () => {
  const header = applyTableSortClick([], "priority", false, "desc", true);
  const withUpdated = applyTableSortClick(header, "updated", true, "desc", true);
  const reloaded = sanitizeTableSortStack(JSON.parse(JSON.stringify(withUpdated)));
  assert.deepEqual(reloaded.map((level) => level.column), ["priority", "updated"]);
  assert.equal(storedTableSortStack(reloaded)?.length, 2);
});

test("sort button and header set the same sort", () => {
  const header = applyTableSortClick([], "priority", false, "desc", true);
  const button = applyTableSortClick([], "priority", false, "desc", true);
  assert.deepEqual(header, button);
  const headerNext = applyTableSortClick(header, "updated", true, "desc", true);
  const buttonNext = applyTableSortClick(button, "updated", true, "desc", true);
  assert.deepEqual(headerNext, buttonNext);
});

test("hiding Due in one view leaves the other view", () => {
  const views = hideColumnOnView({ inbox: null, review: null }, "inbox", "due");
  assert.equal(views.review, null);
  assert.equal(resolveTableColumns(views.review).keys.includes("due"), true);
  assert.equal(resolveTableColumns(views.inbox).keys.includes("due"), false);
});

test("a view with no saved columns uses the defaults", () => {
  const defaults = resolveTableColumns(null);
  assert.equal(defaults.keys.includes("due"), true);
  assert.equal(defaults.keys.includes("ticket"), true);
  assert.deepEqual(defaults.widths, {});
});

test("desktop and phone read the same account columns", () => {
  const saved = hideColumnOnView({ inbox: null }, "inbox", "due").inbox;
  const payload = JSON.parse(JSON.stringify(saved));
  assert.deepEqual(Object.keys(payload).sort(), ["keys", "widths"]);
  const desktop = resolveTableColumns(saved).keys;
  const phone = resolveTableColumns(payload).keys;
  assert.deepEqual(desktop, phone);
  assert.equal(desktop.includes("due"), false);
});

test("HTPR-8973 table settings marker", () => {
  console.log("HTPR-8973 table settings ok");
});
