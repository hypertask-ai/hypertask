import { useEffect, useRef } from "react";
import { useToaster, useToasterStore } from "react-hot-toast";

// PERT-92: forever toasts on mobile.
// react-hot-toast pauses every toast's auto-dismiss timer on mouseenter and
// resumes only on mouseleave. A tap on mobile synthesizes mouseenter (-> pause)
// but lifting the finger fires no mouseleave, so `pausedAt` sticks and finite
// toasts (3s info, 5s undo) stay forever. Resume after each touch so the timer
// runs again. Touch-only: touchend never fires from a mouse, so desktop
// hover-to-pause is untouched.

// Guarded because endPause() computes `now - (pausedAt || 0)`: calling it while
// NOT paused adds ~Date.now() ms to every toast's pauseDuration, which would
// itself wedge them open. Only resume when actually paused.
export const shouldResume = (pausedAt: number | undefined) =>
  pausedAt !== undefined;

export function useMobileToastAutoDismiss() {
  const { handlers } = useToaster();
  const { pausedAt } = useToasterStore();

  const pausedRef = useRef<number | undefined>(undefined);
  pausedRef.current = pausedAt ?? undefined;

  useEffect(() => {
    const resume = () => {
      if (shouldResume(pausedRef.current)) handlers.endPause();
    };
    document.addEventListener("touchend", resume, { passive: true });
    document.addEventListener("touchcancel", resume, { passive: true });
    return () => {
      document.removeEventListener("touchend", resume);
      document.removeEventListener("touchcancel", resume);
    };
  }, [handlers]);
}
