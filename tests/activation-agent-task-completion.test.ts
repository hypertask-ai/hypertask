import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

for (const historical of [false, true]) {
  test(`earlier completion stays first when analytics execute in reverse, historical=${historical}`, async () => {
    const h = activationHarness();
    const early = new Date(1000);
    const late = new Date(2000);
    if (historical) {
      for (const createdAt of [early, late]) h.history.push({ createdAt, activity: {
        type: "TaskMove", data: { fromAgent: { id: "managed" }, toSection: { sectionId: 2 } },
      } });
    }
        const before = h.tasks.get(9);
    h.capture.completion({ ...before, id: 10 }, { ...before, id: 10, sectionId: 2, updatedAt: late }, "managed");
    await h.drain();
    h.capture.completion(before, { ...before, sectionId: 2, updatedAt: early }, "managed");
    await h.drain();
    assert.deepEqual(h.captures.map((event) => event.properties), [
      { taskId: 10, projectId: 15, is_first: !historical },
      { taskId: 9, projectId: 15, is_first: true },
    ]);
    assert.deepEqual(h.logs.map((row) => row.createdAt), [late, early]);
    const cold = activationHarness();
    cold.logs.push(...h.logs);
    cold.capture.activation(
      123, "agent_task_completed", "11", { taskId: 11, projectId: 15 }, new Date(1500),
    );
    await cold.drain();
    assert.equal(cold.captures[0].properties.is_first, false, "an earlier marker survives cold starts");
  });
}

test("only strictly earlier completions disqualify firstness, not simultaneous bulk moves", async () => {
  const h = activationHarness();
  const at = new Date(1000);
  h.history.push({ createdAt: at, activity: { type: "TaskArchive", data: { fromAgent: { id: "managed" }, newStatus: "Archive" } } });
    for (const id of [9, 10]) h.capture.activation(123, "agent_task_completed", String(id), { taskId: id, projectId: 15 }, at);
  await h.drain();
  assert.deepEqual(h.captures.map((event) => event.properties.is_first), [true, true]);
});

test("reopening and recompleting a task does not emit a second activation", async () => {
  const h = activationHarness();
    const before = h.tasks.get(9);
  const done = { ...before, sectionId: 2, section: "Done", updatedAt: new Date(1000) };
  h.capture.completion(before, done, "managed");
  await h.drain();
  h.capture.completion(done, before, "managed");
  h.capture.completion(before, { ...done, updatedAt: new Date(2000) }, "managed");
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.logs.length, 1);
});
