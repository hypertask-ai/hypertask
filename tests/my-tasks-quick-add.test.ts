import assert from "node:assert/strict";
import test from "node:test";

import {
  myTasksQuickAddLikelyVisible,
  resolveMyTasksQuickAddBoardId,
} from "../src/lib/myTasks/quickAddHelpers";
import { mergeMyTasksViewConfigUpdate } from "../src/lib/myTasks/viewConfigMerge";
import {
  parseMyTasksDefaultBoardId,
  parseMyTasksViewConfig,
} from "../src/models/MyTasksView";

test("parseMyTasksDefaultBoardId keeps positive ids only", () => {
  assert.equal(parseMyTasksDefaultBoardId(15), 15);
  assert.equal(parseMyTasksDefaultBoardId(null), null);
  assert.equal(parseMyTasksDefaultBoardId(0), null);
  assert.equal(parseMyTasksDefaultBoardId(-2), null);
  assert.equal(parseMyTasksDefaultBoardId("15"), null);
});

test("parseMyTasksViewConfig round-trips defaultBoardId and rejects junk", () => {
  assert.equal(parseMyTasksViewConfig({}).defaultBoardId, undefined);
  assert.equal(
    parseMyTasksViewConfig({ defaultBoardId: 42 }).defaultBoardId,
    42,
  );
  assert.equal(
    parseMyTasksViewConfig({ defaultBoardId: null }).defaultBoardId,
    null,
  );
  assert.equal(
    parseMyTasksViewConfig({ defaultBoardId: "nope" }).defaultBoardId,
    null,
  );
  const withExtra = parseMyTasksViewConfig({
    defaultBoardId: 7,
    boardIds: [1],
    scopes: ["assigned"],
  });
  assert.equal(withExtra.defaultBoardId, 7);
  assert.deepEqual(withExtra.boardIds, [1]);
  assert.deepEqual(withExtra.scopes, ["assigned"]);
});

test("resolveMyTasksQuickAddBoardId distinguishes unloaded vs empty access", () => {
  assert.equal(resolveMyTasksQuickAddBoardId(9, undefined), 9);
  assert.equal(resolveMyTasksQuickAddBoardId(9, []), null);
  assert.equal(resolveMyTasksQuickAddBoardId(9, [9, 12]), 9);
  assert.equal(resolveMyTasksQuickAddBoardId(9, [12]), null);
  assert.equal(resolveMyTasksQuickAddBoardId(null, [9]), null);
});

test("myTasksQuickAddLikelyVisible matches assigned or created scopes", () => {
  assert.equal(myTasksQuickAddLikelyVisible(["assigned"]), true);
  assert.equal(myTasksQuickAddLikelyVisible(["created", "watching"]), true);
  assert.equal(myTasksQuickAddLikelyVisible(["watching"]), false);
  assert.equal(myTasksQuickAddLikelyVisible(["mentioned"]), false);
});

test("mergeMyTasksViewConfigUpdate keeps defaultBoardId owned by configPatch", () => {
  const fromPatch = mergeMyTasksViewConfigUpdate({
    existingConfig: { boardIds: [1], defaultBoardId: 9 },
    configPatch: { defaultBoardId: 15 },
  });
  assert.equal(fromPatch.defaultBoardId, 15);
  assert.deepEqual(fromPatch.boardIds, [1]);

  const fromFull = mergeMyTasksViewConfigUpdate({
    existingConfig: { boardIds: [1], defaultBoardId: 15 },
    fullConfig: { boardIds: [2, 3], defaultBoardId: 99, scopes: ["watching"] },
  });
  assert.equal(fromFull.defaultBoardId, 15);
  assert.deepEqual(fromFull.boardIds, [2, 3]);
  assert.deepEqual(fromFull.scopes, ["watching"]);

  const clearedExisting = mergeMyTasksViewConfigUpdate({
    existingConfig: { boardIds: [1] },
    fullConfig: { boardIds: [2], defaultBoardId: 44 },
  });
  assert.equal(clearedExisting.defaultBoardId, undefined);
});
