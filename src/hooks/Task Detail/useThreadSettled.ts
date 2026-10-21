import { useCallback, useEffect, useState } from "react";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { useHydrated } from "@/hooks/General/useHydrated";
import { HTPR_7074_TICKET_PAGE_CLS_FLAG } from "@/lib/flags/keys";

const POSITION_TOLERANCE_PX = 1;
const STEADY_MS = 300;
const BUSY_FRAME_MS = 100;
const MAX_HOLD_MS = 5000;

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

function boxTop(slot: HTMLElement): number | null {
  const box = slot.firstElementChild;
  if (!box) return null;
  const top = box.getBoundingClientRect().top;
  const parent = scrollParent(slot);
  if (!parent) return top + window.scrollY;
  return top - parent.getBoundingClientRect().top + parent.scrollTop;
}

const EMPTY_COMMENT_MAX_PX = 8;
function commentStillLoading(): boolean {
  for (const comment of document.querySelectorAll('[data-testid="ticket-comment"]')) {
    if (comment.getBoundingClientRect().height <= EMPTY_COMMENT_MAX_PX) return true;
  }
  return false;
}

export function useThreadSettled(applies: boolean, rowsFinal = true) {
  const flagLoaded = useFlagReady(HTPR_7074_TICKET_PAGE_CLS_FLAG);
  const flagOn = useFlag(HTPR_7074_TICKET_PAGE_CLS_FLAG);
  const hydrated = useHydrated();
  const [settled, setSettled] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const slotRef = useCallback((element: HTMLElement | null) => setSlot(element), []);
  const waiting = applies && !settled && (!flagLoaded || flagOn);
  const ready = flagLoaded && hydrated && rowsFinal;
  useEffect(() => {
    if (!waiting || !slot || !rowsFinal) return;
    const timer = setTimeout(() => setSettled(true), MAX_HOLD_MS);
    return () => clearTimeout(timer);
  }, [waiting, slot, rowsFinal]);
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
