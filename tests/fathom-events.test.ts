import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./helpers/loadModule.cjs";

function loadFathom(window: any) {
  (globalThis as any).window = window;
  return loadModule("src/lib/analytics/fathom.ts", {
    "@/lib/demo/guest": { isGuestUser: (user: any) => user?.uid?.startsWith("guest_") ?? false },
  });
}

const NOW = Date.parse("2026-11-13T12:00:00Z");
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
};
const recent = new Date(NOW - 60_000).toISOString();

test("brand-new account fires Signup completed once and remembers it per user", () => {
  const events: string[] = [];
  const api = loadFathom({ fathom: { trackEvent: (name: string) => events.push(name) } });
  const storage = memory();
  const user = { id: 7, uid: "abc", joinedAt: recent };
  api.trackSignupCompleted(user, 7, storage, NOW);
  api.trackSignupCompleted(user, 7, storage, NOW);
  assert.deepEqual(events, ["Signup completed"]);
  assert.equal(storage.data.get("fathom-signup-completed:7"), "1");
});

test("old accounts, guests, stale atom users and missing users never fire", () => {
  const events: string[] = [];
  const api = loadFathom({ fathom: { trackEvent: (name: string) => events.push(name) } });
  const storage = memory();
  api.trackSignupCompleted({ id: 7, uid: "abc", joinedAt: new Date(NOW - 3 * 3600_000).toISOString() }, 7, storage, NOW);
  api.trackSignupCompleted({ id: 7, uid: "guest_1", joinedAt: recent }, 7, storage, NOW);
  api.trackSignupCompleted({ id: 8, uid: "abc", joinedAt: recent }, 7, storage, NOW);
  api.trackSignupCompleted({ id: 7, uid: "abc", joinedAt: recent }, null, storage, NOW);
  api.trackSignupCompleted(null, 7, storage, NOW);
  api.trackSignupCompleted({ id: 7, uid: "abc", joinedAt: "not a date" }, 7, storage, NOW);
  assert.deepEqual(events, []);
  assert.equal(storage.data.size, 0);
});

test("event waits for the Fathom script and is not marked sent before it fires", async () => {
  const events: string[] = [];
  const window: any = {};
  const api = loadFathom(window);
  const storage = memory();
  api.trackSignupCompleted({ id: 7, uid: "abc", joinedAt: recent }, 7, storage, NOW);
  assert.equal(storage.data.size, 0);
  window.fathom = { trackEvent: (name: string) => events.push(name) };
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.deepEqual(events, ["Signup completed"]);
  assert.equal(storage.data.get("fathom-signup-completed:7"), "1");
});

test("cleanup cancels a pending retry", async () => {
  const events: string[] = [];
  const window: any = {};
  const api = loadFathom(window);
  const cancel = api.trackFathomEvent("Login page viewed");
  cancel();
  window.fathom = { trackEvent: (name: string) => events.push(name) };
  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.deepEqual(events, []);
});
