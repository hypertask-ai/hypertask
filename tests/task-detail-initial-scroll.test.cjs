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

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end).trimEnd();
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
  const bottomPositioning = sourceBetween(
    source,
    "// Reliably land at the very bottom of the thread on mobile.",
    "// A scroll gesture owns initial positioning for one task."
  );
  const taskLifecycle = sourceBetween(
    source,
    "// A scroll gesture owns initial positioning for one task.",
    "// Rebind input listeners without restarting initial positioning."
  );
  const viewportLifecycle = sourceBetween(
    source,
    "// Rebind input listeners without restarting initial positioning.",
    "//Initial Scroll and focus when page loads"
  );
  const mountPositioning = sourceBetween(
    source,
    "//Initial Scroll and focus when page loads",
    "// Where a freshly-opened task lands."
  );
  const unreadPositioning = sourceBetween(
    source,
    "// Where a freshly-opened task lands.",
    "  useEffect(() => {\n    if (embedded) return;"
  );
  const unreadDependencyStart = unreadPositioning?.lastIndexOf("}, [") ?? -1;

  assert.match(bottomPositioning, /!initialScrollGuard\.allows\(generation\)/);
  assert.match(
    bottomPositioning,
    /\}, \[initialScrollGuard, scrollElementRef\]\);$/
  );
  assert.match(taskLifecycle, /initialScrollGuard\.reset\(\)/);
  assert.match(taskLifecycle, /initialScrollGuard\.invalidate\(generation\)/);
  assert.match(
    taskLifecycle,
    /\}, \[_parsedTask\.id, initialScrollGuard\]\);$/
  );
  assert.match(
    viewportLifecycle,
    /previousViewport\.taskId === _parsedTask\.id[\s\S]*?previousViewport\.isMobile !== _mbl[\s\S]*?initialScrollGuard\.invalidate/
  );
  assert.match(
    viewportLifecycle,
    /initialScrollGuard\.listen\(scrollElementRef\?\.current \?\? window\)/
  );
  assert.doesNotMatch(viewportLifecycle, /if \(!_mbl\) return/);
  assert.match(
    viewportLifecycle,
    /\}, \[_mbl, _parsedTask\.id, initialScrollGuard, scrollElementRef\]\);$/
  );
  assert.match(mountPositioning, /runInitialPositioning\(scrollToElement\)/);
  assert.match(mountPositioning, /runInitialPositioning\(\(\) =>\s*focusOn/);
  assert.match(mountPositioning, /\}, \[_parsedTask\.id\]\);$/);
  assert.match(unreadPositioning, /initialScrollGuard\.allows\(generation\)/);
  assert.notEqual(
    unreadDependencyStart,
    -1,
    "the unread effect dependency array must be found"
  );
  const unreadDependencyList = unreadPositioning.slice(unreadDependencyStart);
  assert.match(unreadDependencyList, /_parsedTask\.id/);
  assert.doesNotMatch(unreadDependencyList, /_mbl/);
  assert.match(
    unreadPositioning,
    /requestAnimationFrame\(\(\) => \{\s*runInitialPositioning\(\(\) => \{/
  );
});
