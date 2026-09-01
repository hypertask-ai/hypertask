import assert from "node:assert/strict";
import test from "node:test";
import { createAutoTitleGenerationCoordinator } from "../src/lib/ai/autoTitleGeneration";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const fakeTimers = () => {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  return {
    setTimer(callback: () => void) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer(timer: ReturnType<typeof setTimeout>) {
      callbacks.delete(timer as unknown as number);
    },
    runNext() {
      const entry = callbacks.entries().next().value as
        [number, () => void] | undefined;
      assert.ok(entry, "expected a pending timer");
      callbacks.delete(entry[0]);
      entry[1]();
    },
    get size() {
      return callbacks.size;
    },
  };
};

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("description writing waits five seconds and only the latest title applies", async () => {
  const timers = fakeTimers();
  const applied: string[] = [];
  const coordinator = createAutoTitleGenerationCoordinator({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.schedule("first", {
    generate: async () => "First title",
    apply: (title) => applied.push(title),
  });
  coordinator.schedule("second", {
    generate: async () => "Second title",
    apply: (title) => applied.push(title),
  });

  assert.equal(timers.size, 1, "further writing must replace the timer");
  timers.runNext();
  await flushPromises();
  assert.deepEqual(applied, ["Second title"]);
});

test("opening Task Writer keeps an edited description stale until a title is generated", () => {
  const timers = fakeTimers();
  const coordinator = createAutoTitleGenerationCoordinator({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  coordinator.schedule("edited description", {
    generate: async () => "Generated title",
  });
  coordinator.enableFromTaskWriter();
  assert.equal(
    coordinator.needsGenerationForSave("Older title", "edited description"),
    true,
  );
});

test("manual title input cancels an in-flight response until Task Writer re-enables it", async () => {
  const timers = fakeTimers();
  const first = deferred<string>();
  const applied: string[] = [];
  let firstSignal: AbortSignal | undefined;
  const coordinator = createAutoTitleGenerationCoordinator({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.schedule("description", {
    generate: (signal) => {
      firstSignal = signal;
      return first.promise;
    },
    apply: (title) => applied.push(title),
  });
  timers.runNext();
  coordinator.manualTitleChanged();
  assert.equal(firstSignal?.aborted, true);
  first.resolve("Stale title");
  await flushPromises();
  assert.equal(applied.length, 0);
  assert.equal(coordinator.isEnabled(), false);

  coordinator.enableFromTaskWriter();
  coordinator.schedule("description updated", {
    generate: async () => "Fresh title",
    apply: (title) => applied.push(title),
  });
  timers.runNext();
  await flushPromises();
  assert.deepEqual(applied, ["Fresh title"]);
});

test("save cancels background work and returns the newest generated title directly", async () => {
  const timers = fakeTimers();
  const stale = deferred<string>();
  const applied: string[] = [];
  let staleSignal: AbortSignal | undefined;
  const coordinator = createAutoTitleGenerationCoordinator({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  coordinator.schedule("old description", {
    generate: (signal) => {
      staleSignal = signal;
      return stale.promise;
    },
    apply: (title) => applied.push(title),
  });
  timers.runNext();

  const title = await coordinator.generateNow("latest description", {
    generate: async () => "Latest title",
  });
  assert.equal(staleSignal?.aborted, true);
  assert.equal(title, "Latest title");

  stale.resolve("Old title");
  await flushPromises();
  assert.deepEqual(applied, []);
  assert.equal(
    coordinator.needsGenerationForSave(title ?? "", "latest description"),
    false,
  );
});

test("a description edit during save invalidates that result for a retry", async () => {
  const timers = fakeTimers();
  const saving = deferred<string>();
  const coordinator = createAutoTitleGenerationCoordinator({
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  const saveResult = coordinator.generateNow("before edit", {
    generate: () => saving.promise,
  });
  coordinator.schedule("after edit", {
    generate: async () => "After edit",
  });
  saving.resolve("Before edit");

  assert.equal(await saveResult, null);
  assert.equal(
    coordinator.needsGenerationForSave("Old generated title", "after edit"),
    true,
  );
});

test("board changes clear generated titles but preserve manual title ownership", async () => {
  const coordinator = createAutoTitleGenerationCoordinator();
  await coordinator.generateNow("description", {
    generate: async () => "Generated title",
  });
  coordinator.schedule("", { generate: async () => "Unused title" });
  assert.equal(
    coordinator.needsGenerationForSave("Generated title", ""),
    false,
    "an empty description must not make save retry forever",
  );
  assert.equal(coordinator.boardChanged(), true);

  coordinator.manualTitleChanged();
  assert.equal(coordinator.boardChanged(), false);
  assert.equal(coordinator.isEnabled(), false);
});

test("reset and cancellation reject old responses without breaking a reused composer", async () => {
  const pending = deferred<string>();
  const coordinator = createAutoTitleGenerationCoordinator();
  const oldResult = coordinator.generateNow("old draft", {
    generate: () => pending.promise,
  });

  coordinator.cancelPending();
  pending.resolve("Old title");
  assert.equal(await oldResult, null);

  coordinator.reset();
  assert.equal(
    await coordinator.generateNow("new draft", {
      generate: async () => "New title",
    }),
    "New title",
  );
});

test("current request failures propagate while superseded failures are ignored", async () => {
  const coordinator = createAutoTitleGenerationCoordinator();
  const failure = new Error("generation failed");
  await assert.rejects(
    coordinator.generateNow("description", {
      generate: async () => {
        throw failure;
      },
    }),
    failure,
  );

  const superseded = deferred<string>();
  const oldResult = coordinator.generateNow("old", {
    generate: () => superseded.promise,
  });
  coordinator.manualTitleChanged();
  superseded.reject(failure);
  assert.equal(await oldResult, null);
});
