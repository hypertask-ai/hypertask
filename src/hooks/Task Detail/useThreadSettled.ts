import { useEffect, useState } from "react";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { useHydrated } from "@/hooks/General/useHydrated";
import { HTPR_7074_TICKET_PAGE_CLS_FLAG } from "@/lib/flags/keys";

// Frames the thread height must stay unchanged before the comment box may appear.
const STEADY_FRAMES = 24;
// The box shows after this long whatever the thread does, once the flag is known.
const MAX_HOLD_MS = 2000;

// HTPR-7074: the comment box follows a virtualized list whose height grows as rows are
// measured, so showing it early makes it jump down. Returns true once the box may render:
// at once when the fix does not apply or its flag is Off (today's behaviour), otherwise after
// the rows are on the page and the thread height has stopped changing.
// Counts frames, not milliseconds: a busy phone measures rows late and slowly.
export function useThreadSettled(totalSize: number, rowCount: number, applies: boolean) {
  const flagLoaded = useFlagReady(HTPR_7074_TICKET_PAGE_CLS_FLAG);
  const flagOn = useFlag(HTPR_7074_TICKET_PAGE_CLS_FLAG);
  const hydrated = useHydrated();
  const [settled, setSettled] = useState(false);
  const waiting = applies && !settled && (!flagLoaded || flagOn);
  const measuring = waiting && flagLoaded && hydrated && rowCount > 0;
  useEffect(() => {
    if (!measuring) return;
    let frames = 0;
    let frame = 0;
    const tick = () => {
      frames += 1;
      if (frames >= STEADY_FRAMES) setSettled(true);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // A new height restarts the count.
  }, [measuring, totalSize, rowCount]);
  const holding = waiting && flagLoaded;
  const hasRows = rowCount > 0 && hydrated;
  useEffect(() => {
    if (!holding) return;
    // Hard stop: no row count or endlessly changing height may hide the box for good.
    // The clock restarts once, when the rows first appear: a slow phone hydrates late.
    const timer = setTimeout(() => setSettled(true), MAX_HOLD_MS);
    return () => clearTimeout(timer);
  }, [holding, hasRows]);
  return !waiting;
}
