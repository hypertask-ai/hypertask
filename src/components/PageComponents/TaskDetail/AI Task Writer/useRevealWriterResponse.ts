import { useEffect, type RefObject } from "react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7338_AI_WRITER_STAYS_VISIBLE_FLAG } from "@/lib/flags/definitions/htpr-7338-ai-writer-stays-visible";

export function useRevealWriterResponse(
  panelRef: RefObject<HTMLElement | null>,
  hasResponse: boolean,
  isMobile: boolean,
) {
  const enabled = useFlag(HTPR_7338_AI_WRITER_STAYS_VISIBLE_FLAG);

  useEffect(() => {
    if (!enabled || isMobile || !hasResponse) return;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [enabled, isMobile, hasResponse, panelRef]);
}
