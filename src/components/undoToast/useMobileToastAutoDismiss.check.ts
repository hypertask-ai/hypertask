// Runnable check for the PERT-92 mobile forever-toast fix.
// Run: node --experimental-strip-types src/components/undoToast/useMobileToastAutoDismiss.check.ts
//
// Faithful model of react-hot-toast's pause reducer (actions 5/6) and its
// dismiss-scheduling effect, so the check proves the actual bug and that the
// guarded `shouldResume` gate fixes it without re-wedging the toast.
import assert from "node:assert";
// @ts-ignore -- explicit .ts extension is required by `node --experimental-strip-types`
import { shouldResume } from "./useMobileToastAutoDismiss.ts";

type Toast = { createdAt: number; duration: number; pauseDuration: number };
type Store = { pausedAt: number | undefined };

const startPause = (now: number): Store => ({ pausedAt: now }); // action 5
const endPause = (s: Store, t: Toast, now: number): Store => {
  // action 6: n = now - (pausedAt||0); note the `||0` landmine when not paused.
  t.pauseDuration += now - (s.pausedAt || 0);
  return { pausedAt: undefined };
};
// The Toaster effect: `if (s) return` while paused -> no dismiss timer at all.
// Otherwise it schedules dismissal at now + (duration + pauseDuration - age).
const scheduledDismissAt = (s: Store, t: Toast, now: number): number | null => {
  if (s.pausedAt !== undefined) return null;
  const remaining = t.duration + t.pauseDuration - (now - t.createdAt);
  return now + Math.max(remaining, 0);
};

// 1. The bug: tap pauses, finger lifts with no mouseleave -> never dismisses.
{
  const t: Toast = { createdAt: 0, duration: 3000, pauseDuration: 0 };
  const s = startPause(500); // synthetic mouseenter from the tap
  assert.strictEqual(
    scheduledDismissAt(s, t, 4000),
    null,
    "bug repro: a paused toast schedules no dismiss timer (forever toast)",
  );
}

// 2. The fix: touchend resumes (guarded) -> toast dismisses, just shifted by the
//    pause it sat through.
{
  const t: Toast = { createdAt: 0, duration: 3000, pauseDuration: 0 };
  let s = startPause(500);
  if (shouldResume(s.pausedAt)) s = endPause(s, t, 700); // touchend at 700ms
  assert.strictEqual(t.pauseDuration, 200, "paused 500->700 adds 200ms");
  assert.strictEqual(
    scheduledDismissAt(s, t, 700),
    3200,
    "fix: resumes and dismisses (3000 + 200 pause)",
  );
}

// 3. The guard earns its keep: touchend while NOT paused must be a no-op.
//    Without the shouldResume gate, endPause adds ~Date.now() ms of pause and
//    would itself wedge the toast open forever.
{
  const t: Toast = { createdAt: 0, duration: 3000, pauseDuration: 0 };
  let s: Store = { pausedAt: undefined };
  if (shouldResume(s.pausedAt)) s = endPause(s, t, 999999); // gate skips this
  assert.strictEqual(t.pauseDuration, 0, "guard: no pause inflation when idle");
  assert.strictEqual(
    scheduledDismissAt(s, t, 1000),
    3000,
    "guard: idle toast still dismisses on schedule",
  );
}

console.log("useMobileToastAutoDismiss: all checks passed");
