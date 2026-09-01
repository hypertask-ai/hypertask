const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
const { createTaskDetailInitialScrollGuard } = jiti(
  path.join(root, "src/lib/taskDetailInitialScroll.ts")
);

function runFlag(guard, generation) {
  let ran = false;
  const allowed = guard.run(generation, () => {
    ran = true;
  });
  return { allowed, ran };
}

test("an untouched task can run its initial positioning", () => {
  const guard = createTaskDetailInitialScrollGuard(() => {});
  const generation = guard.reset();

  assert.deepEqual(runFlag(guard, generation), { allowed: true, ran: true });
});

test("a mobile scroll gesture cancels and blocks delayed positioning", () => {
  let cancellations = 0;
  const guard = createTaskDetailInitialScrollGuard(() => {
    cancellations += 1;
  });
  const generation = guard.reset();
  const target = new EventTarget();
  const cleanup = guard.listen(target);

  target.dispatchEvent(new Event("scroll"));
  assert.deepEqual(runFlag(guard, generation), { allowed: true, ran: true });

  target.dispatchEvent(new Event("touchmove"));
  assert.equal(cancellations, 1);
  assert.deepEqual(runFlag(guard, generation), { allowed: false, ran: false });

  target.dispatchEvent(new Event("wheel"));
  assert.equal(cancellations, 1);
  cleanup();
});

test("a gesture during settling blocks the next positioning frame", () => {
  const guard = createTaskDetailInitialScrollGuard(() => {});
  const generation = guard.reset();
  const target = new EventTarget();
  const cleanup = guard.listen(target);

  assert.deepEqual(runFlag(guard, generation), { allowed: true, ran: true });
  target.dispatchEvent(new Event("wheel"));
  assert.deepEqual(runFlag(guard, generation), { allowed: false, ran: false });
  cleanup();
});

test("task changes reject stale callbacks and allow the next untouched task", () => {
  let cancellations = 0;
  const guard = createTaskDetailInitialScrollGuard(() => {
    cancellations += 1;
  });
  const firstGeneration = guard.reset();
  const secondGeneration = guard.reset();

  assert.equal(cancellations, 1);
  assert.deepEqual(runFlag(guard, firstGeneration), { allowed: false, ran: false });
  assert.deepEqual(runFlag(guard, secondGeneration), { allowed: true, ran: true });
});

test("unmount invalidation rejects pending callbacks", () => {
  let cancellations = 0;
  const guard = createTaskDetailInitialScrollGuard(() => {
    cancellations += 1;
  });
  const generation = guard.reset();

  assert.equal(guard.invalidate(generation), true);
  assert.equal(cancellations, 1);
  assert.deepEqual(runFlag(guard, generation), { allowed: false, ran: false });
  assert.equal(guard.invalidate(generation), false);
  assert.equal(cancellations, 1);
});

test("listener cleanup stops later gestures from changing the guard", () => {
  const guard = createTaskDetailInitialScrollGuard(() => {});
  const generation = guard.reset();
  const target = new EventTarget();
  const cleanup = guard.listen(target);

  cleanup();
  target.dispatchEvent(new Event("touchmove"));
  assert.deepEqual(runFlag(guard, generation), { allowed: true, ran: true });
});

test("task detail wires the guard to task lifecycle and every delayed mobile scroll", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/detail/[...slug]/TaskDetailComp.tsx"),
    "utf8"
  );
  const taskLifecycle = source.match(
    /useLayoutEffect\(\(\) => \{[\s\S]*?initialScrollGuard\.reset\(\);[\s\S]*?initialScrollGuard\.invalidate\(generation\);[\s\S]*?\}, \[_parsedTask\.id, initialScrollGuard\]\);/
  )?.[0];
  const viewportLifecycle = source.match(
    /useLayoutEffect\(\(\) => \{\s*const previousViewport[\s\S]*?initialScrollGuard\.listen\(scrollElementRef\?\.current \?\? window\);[\s\S]*?\}, \[_mbl, _parsedTask\.id, initialScrollGuard, scrollElementRef\]\);/
  )?.[0];
  const mountPositioning = source.match(
    /\/\/Initial Scroll and focus when page loads[\s\S]*?\}, \[\]\);/
  )?.[0];
  const unreadPositioning = source.match(
    /\/\/ Where a freshly-opened task lands[\s\S]*?visibleCommentIndices,[\s\S]*?\]\);/
  )?.[0];

  assert.ok(taskLifecycle, "the guard must reset only with the canonical task ID");
  assert.ok(viewportLifecycle, "the mobile listener must follow the active viewport");
  assert.match(
    viewportLifecycle,
    /previousViewport\.taskId === _parsedTask\.id[\s\S]*?previousViewport\.isMobile !== _mbl[\s\S]*?initialScrollGuard\.invalidate/
  );
  assert.match(source, /!initialScrollGuard\.allows\(generation\)/);
  assert.ok(mountPositioning, "the mount positioning effect must remain guarded");
  assert.match(mountPositioning, /runInitialPositioning\(scrollToElement\)/);
  assert.match(mountPositioning, /runInitialPositioning\(\(\) =>\s*focusOn/);
  assert.ok(unreadPositioning, "the unread positioning effect must remain guarded");
  assert.match(unreadPositioning, /initialScrollGuard\.allows\(generation\)/);
  assert.doesNotMatch(
    unreadPositioning.slice(unreadPositioning.lastIndexOf("}, [")),
    /_mbl/
  );
  assert.match(
    unreadPositioning,
    /requestAnimationFrame\(\(\) => \{\s*runInitialPositioning\(\(\) => \{/
  );
});
