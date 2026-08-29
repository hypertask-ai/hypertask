import assert from "node:assert/strict";
import test from "node:test";

import {
  getMobileSectionObserverOptions,
  getProgressiveTaskRenderMode,
  shouldWarmInitialBoardTasks,
} from "../src/lib/boardStartup/mobileProgressiveRendering";

test("only nearby mobile sections warm full cards on large boards", () => {
  assert.equal(
    shouldWarmInitialBoardTasks({
      isMobile: true,
      progressiveRendering: true,
      sectionNearViewport: false,
    }),
    false,
  );
  assert.equal(
    shouldWarmInitialBoardTasks({
      isMobile: true,
      progressiveRendering: true,
      sectionNearViewport: true,
    }),
    true,
  );
  assert.equal(
    shouldWarmInitialBoardTasks({
      isMobile: false,
      progressiveRendering: true,
      sectionNearViewport: false,
    }),
    true,
  );
});

test("desktop retains full skeletons while the card module loads", () => {
  assert.equal(
    getProgressiveTaskRenderMode({
      isMobile: false,
      taskModuleReady: false,
      taskModuleFailed: false,
      shouldRenderTask: false,
    }),
    "skeleton",
  );
  assert.equal(
    getProgressiveTaskRenderMode({
      isMobile: true,
      taskModuleReady: false,
      taskModuleFailed: false,
      shouldRenderTask: false,
    }),
    "placeholder",
  );
});

test("section prewarm is relative to the nested horizontal scroller", () => {
  const horizontalScroller = {} as Element;
  assert.deepEqual(getMobileSectionObserverOptions(horizontalScroller), {
    root: horizontalScroller,
    rootMargin: "0px 160px",
  });
});

test("a failed card module keeps navigable placeholders", () => {
  assert.equal(
    getProgressiveTaskRenderMode({
      isMobile: false,
      taskModuleReady: false,
      taskModuleFailed: true,
      shouldRenderTask: true,
    }),
    "placeholder",
  );
});
