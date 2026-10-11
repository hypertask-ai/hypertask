import { useCallback, useEffect, useState } from "react";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { useHydrated } from "@/hooks/General/useHydrated";
import { HTPR_7074_TICKET_PAGE_CLS_FLAG } from "@/lib/flags/keys";

// The box shows once its own top has not changed by more than this many pixels for STEADY_MS.
const POSITION_TOLERANCE_PX = 1;
const STEADY_MS = 300;
// A frame later than this after the previous one means the page was busy: the box may have moved and
// settled again between two frames without being seen, so the wait restarts.
const BUSY_FRAME_MS = 100;
// The box shows this long after the hook first saw its slot whatever else happens. Never restarted.
// Counted from after hydration: on a slow phone the last comment's body lands about 3 s after that.
const MAX_HOLD_MS = 5000;

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

// Top of the box measured from the top of its scrolled content, so scrolling does not count as a move.
// The slot itself has no box (display: contents), so the first element inside it is measured.
function boxTop(slot: HTMLElement): number | null {
  const box = slot.firstElementChild;
  if (!box) return null;
  const top = box.getBoundingClientRect().top;
  const parent = scrollParent(slot);
  if (!parent) return top + window.scrollY;
  return top - parent.getBoundingClientRect().top + parent.scrollTop;
}

// A comment whose body has not mounted yet is only its 8 px of padding. The last comment's editor loads
// last on a slow phone and then grows the thread by a whole comment, so the box waits for it.
const EMPTY_COMMENT_MAX_PX = 8;
function commentStillLoading(): boolean {
  for (const comment of document.querySelectorAll('[data-testid="ticket-comment"]')) {
    if (comment.getBoundingClientRect().height <= EMPTY_COMMENT_MAX_PX) return true;
  }
  return false;
}

// HTPR-7074: the comment box sits under a virtualized thread and details that keep growing, so showing it
// early makes it jump. While it is hidden (it still takes its space) this watches the box's own top every
// frame and returns settled once the top has held still for 300 ms and the page is hydrated, or 3000 ms
// after the slot mounted. Settled at once when the fix does not apply or its flag is Off (today's behaviour).
// Pass `slotRef` to SettledComposerSlot.
export function useThreadSettled(applies: boolean) {
  const flagLoaded = useFlagReady(HTPR_7074_TICKET_PAGE_CLS_FLAG);
  const flagOn = useFlag(HTPR_7074_TICKET_PAGE_CLS_FLAG);
  const hydrated = useHydrated();
  const [settled, setSettled] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const slotRef = useCallback((element: HTMLElement | null) => setSlot(element), []);
  const waiting = applies && !settled && (!flagLoaded || flagOn);
  const ready = flagLoaded && hydrated;
  useEffect(() => {
    if (!waiting || !slot) return;
    // Hard stop, not gated on the flags request: it must never hide the box for good.
    const timer = setTimeout(() => setSettled(true), MAX_HOLD_MS);
    return () => clearTimeout(timer);
  }, [waiting, slot]);
  useEffect(() => {
    if (!waiting || !slot || !ready) return;
    let frame = 0;
    let last: number | null = null;
    let since = 0;
    let previousFrame: number | null = null;
    const tick = (now: number) => {
      const top = boxTop(slot);
      const busy = previousFrame !== null && now - previousFrame > BUSY_FRAME_MS;
      previousFrame = now;
      if (busy || commentStillLoading() || top === null || last === null || Math.abs(top - last) > POSITION_TOLERANCE_PX) {
        last = top;
        since = now;
      } else if (now - since >= STEADY_MS) {
        setSettled(true);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [waiting, slot, ready]);
  return { settled: !waiting, slotRef };
}
