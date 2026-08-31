import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error jsdom is installed without its separate declaration package.
import { JSDOM } from "jsdom";
import {
  getTaskPlaylistBounds,
  resistedTaskSwipeOffset,
  resolveTaskSwipeIntent,
  resolveTaskSwipeNavigation,
  shouldIgnoreTaskSwipeStart,
} from "../src/lib/taskDetailSwipe";

const playlist = [
  { projectId: 15, uniqueIndex: 101 },
  { projectId: 15, uniqueIndex: 102 },
  { projectId: 15, uniqueIndex: 103 },
];

test("playlist bounds disable navigation at each end and outside the context", () => {
  assert.deepEqual(getTaskPlaylistBounds(playlist, playlist[0]), {
    currentIndex: 0, previousDisabled: true, nextDisabled: false,
  });
  assert.deepEqual(getTaskPlaylistBounds(playlist, playlist[2]), {
    currentIndex: 2, previousDisabled: false, nextDisabled: true,
  });
  assert.deepEqual(getTaskPlaylistBounds(playlist, { projectId: 15, uniqueIndex: 999 }), {
    currentIndex: -1, previousDisabled: true, nextDisabled: true,
  });
});

test("horizontal intent starts after 16px while vertical intent wins", () => {
  assert.equal(resolveTaskSwipeIntent(16, 0), "pending");
  assert.equal(resolveTaskSwipeIntent(17, 4), "horizontal");
  assert.equal(resolveTaskSwipeIntent(12, 20), "vertical");
  assert.equal(resolveTaskSwipeIntent(20, 20), "vertical");
});

test("release navigates only past the threshold and within playlist bounds", () => {
  const middle = getTaskPlaylistBounds(playlist, playlist[1]);
  assert.equal(resolveTaskSwipeNavigation(-140, 400, middle), "next");
  assert.equal(resolveTaskSwipeNavigation(140, 400, middle), "previous");
  assert.equal(resolveTaskSwipeNavigation(-139, 400, middle), null);
  const first = getTaskPlaylistBounds(playlist, playlist[0]);
  const last = getTaskPlaylistBounds(playlist, playlist[2]);
  assert.equal(resolveTaskSwipeNavigation(200, 400, first), null);
  assert.equal(resolveTaskSwipeNavigation(-200, 400, last), null);
  assert.equal(resistedTaskSwipeOffset(100, first), 20);
  assert.equal(resistedTaskSwipeOffset(-100, last), -20);
});

test("editors and horizontal scrollers keep control of their touches", () => {
  const { document } = new JSDOM(`<main id="boundary">
    <div contenteditable="true"><span id="editor">text</span></div>
    <div id="scroller" style="overflow-x:auto"><button id="scroll">item</button></div>
    <button id="plain">item</button>
  </main>`).window;
  const boundary = document.querySelector("#boundary") as HTMLElement;
  const scroller = document.querySelector("#scroller") as HTMLElement;
  Object.defineProperty(scroller, "clientWidth", { value: 200 });
  Object.defineProperty(scroller, "scrollWidth", { value: 500 });

  assert.equal(shouldIgnoreTaskSwipeStart(document.querySelector("#editor"), boundary), true);
  assert.equal(shouldIgnoreTaskSwipeStart(document.querySelector("#scroll"), boundary), true);
  assert.equal(shouldIgnoreTaskSwipeStart(document.querySelector("#plain"), boundary), false);
});
