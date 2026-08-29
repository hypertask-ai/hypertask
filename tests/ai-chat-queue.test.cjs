const { test } = require("node:test");
const assert = require("node:assert/strict");

/** Mirrors HTPR-5695 FIFO queue drain: pop head, leave the rest. */
function drainQueue(queue) {
  if (queue.length === 0) return { next: null, rest: queue };
  const [next, ...rest] = queue;
  return { next, rest };
}

test("drainQueue pops FIFO head", () => {
  const queue = [
    { id: "a", content: "first" },
    { id: "b", content: "second" },
  ];
  const first = drainQueue(queue);
  assert.equal(first.next.id, "a");
  assert.deepEqual(
    first.rest.map((item) => item.id),
    ["b"]
  );
  const second = drainQueue(first.rest);
  assert.equal(second.next.id, "b");
  assert.deepEqual(second.rest, []);
});

test("drainQueue on empty returns null next", () => {
  const empty = drainQueue([]);
  assert.equal(empty.next, null);
  assert.deepEqual(empty.rest, []);
});
