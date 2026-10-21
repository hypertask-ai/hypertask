import { useEffect, useRef } from "react";
import { useToaster, useToasterStore } from "react-hot-toast";


export const shouldResume = (pausedAt: number | undefined) =>
  pausedAt !== undefined;

export function useMobileToastAutoDismiss(toasterId?: string) {
  const { handlers } = useToaster(undefined, toasterId);
  const { pausedAt } = useToasterStore(undefined, toasterId);

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
