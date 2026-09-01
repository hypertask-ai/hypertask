import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  BOARD_OVERVIEW_SCALE,
  getMobileDragDelay,
  getPinchZoomState,
  MOBILE_COLUMN_DRAG_DELAY_MS,
  MOBILE_TASK_DRAG_DELAY_MS,
  setProjectBoardZoom,
  toggleProjectBoardZoom,
} from "../src/hooks/Kanban/mobileBoardGestures";

test("mobile board pinch jumps from normal to the fixed overview state", () => {
  assert.equal(BOARD_OVERVIEW_SCALE, 0.5);
  assert.equal(
    getPinchZoomState({
      zoomedOut: false,
      startDistance: 200,
      currentDistance: 169,
      touchCount: 2,
    }),
    true,
  );
  assert.equal(
    getPinchZoomState({
      zoomedOut: true,
      startDistance: 200,
      currentDistance: 231,
      touchCount: 2,
    }),
    false,
  );
});

test("small movement and every touch count except two leave board zoom unchanged", () => {
  for (const touchCount of [0, 1, 3]) {
    assert.equal(
      getPinchZoomState({
        zoomedOut: false,
        startDistance: 200,
        currentDistance: 100,
        touchCount,
      }),
      false,
    );
  }
  assert.equal(
    getPinchZoomState({
      zoomedOut: false,
      startDistance: 200,
      currentDistance: 180,
      touchCount: 2,
    }),
    false,
  );
  assert.equal(
    getPinchZoomState({
      zoomedOut: true,
      startDistance: 200,
      currentDistance: 220,
      touchCount: 2,
    }),
    true,
  );
});

test("mobile task pickup waits roughly a second without changing column pickup", () => {
  assert.equal(getMobileDragDelay("task-42"), MOBILE_TASK_DRAG_DELAY_MS);
  assert.equal(MOBILE_TASK_DRAG_DELAY_MS, 900);
  assert.equal(getMobileDragDelay("column-7"), MOBILE_COLUMN_DRAG_DELAY_MS);
  assert.equal(MOBILE_COLUMN_DRAG_DELAY_MS, 120);
});

test("zoom state stays scoped to its board", () => {
  const firstBoardOverview = toggleProjectBoardZoom({}, 10);
  const secondBoardOverview = toggleProjectBoardZoom(firstBoardOverview, 20);
  const firstBoardNormal = setProjectBoardZoom(secondBoardOverview, 10, false);

  assert.deepEqual(firstBoardOverview, { 10: true });
  assert.deepEqual(secondBoardOverview, { 10: true, 20: true });
  assert.deepEqual(firstBoardNormal, { 10: false, 20: true });
});

test("overview styling and drag blocking stay mobile-only", () => {
  const source = fs.readFileSync(
    path.resolve(
      process.cwd(),
      "src/components/PageComponents/Kanban/KanbanHomepageComponents/Homepage.tsx",
    ),
    "utf8",
  );

  assert.match(
    source,
    /const mobileBoardZoomedOut = _mbl && boardZoomedOut;/,
  );
  assert.match(source, /isDragDisabled=\{[^}]*mobileBoardZoomedOut\}/);
  assert.match(source, /dragDisabled=\{mobileBoardZoomedOut\}/);
  assert.match(source, /style=\{mobileBoardZoomedOut \? \{/);
});
