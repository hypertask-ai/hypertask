import assert from "node:assert";
// @ts-expect-error Node strip-types checks require .ts imports without allowImportingTsExtensions.
import { shouldResume } from "./useMobileToastAutoDismiss.ts";

type Toast = { createdAt: number; duration: number; pauseDuration: number };
type Store = { pausedAt: number | undefined };

const startPause = (now: number): Store => ({ pausedAt: now });
const endPause = (s: Store, t: Toast, now: number): Store => {
  t.pauseDuration += now - (s.pausedAt || 0);
  return { pausedAt: undefined };
};
const scheduledDismissAt = (s: Store, t: Toast, now: number): number | null => {
  if (s.pausedAt !== undefined) return null;
  const remaining = t.duration + t.pauseDuration - (now - t.createdAt);
  return now + Math.max(remaining, 0);
};

{
  const t: Toast = { createdAt: 0, duration: 3000, pauseDuration: 0 };
  const s = startPause(500);
  assert.strictEqual(
    scheduledDismissAt(s, t, 4000),
    null,
    "bug repro: a paused toast schedules no dismiss timer (forever toast)",
  );
}

{
  const t: Toast = { createdAt: 0, duration: 3000, pauseDuration: 0 };
  let s = startPause(500);
  if (shouldResume(s.pausedAt)) s = endPause(s, t, 700);
  assert.strictEqual(t.pauseDuration, 200, "paused 500->700 adds 200ms");
  assert.strictEqual(
    scheduledDismissAt(s, t, 700),
    3200,
    "fix: resumes and dismisses (3000 + 200 pause)",
  );
}

{
  const t: Toast = { createdAt: 0, duration: 3000, pauseDuration: 0 };
  let s: Store = { pausedAt: undefined };
  if (shouldResume(s.pausedAt)) s = endPause(s, t, 999999);
  assert.strictEqual(t.pauseDuration, 0, "guard: no pause inflation when idle");
  assert.strictEqual(
    scheduledDismissAt(s, t, 1000),
    3000,
    "guard: idle toast still dismisses on schedule",
  );
}

console.log("useMobileToastAutoDismiss: all checks passed");
