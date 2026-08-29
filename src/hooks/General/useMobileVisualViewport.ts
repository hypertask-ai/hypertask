import { useEffect, useState } from "react";
import {
  getMobileVisualViewportGeometry,
  type MobileVisualViewportGeometry,
} from "@/lib/mobileCommentViewport";

export interface MobileVisualViewportState
  extends MobileVisualViewportGeometry {
  layoutHeight: number;
}

export const useMobileVisualViewport = (enabled = true) => {
  const [viewport, setViewport] = useState<MobileVisualViewportState | null>(
    null
  );

  useEffect(() => {
    if (!enabled) return;

    const visualViewport = window.visualViewport;
    let animationFrameId: number | undefined;

    const measure = () => {
      if (animationFrameId !== undefined) {
        window.cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = window.requestAnimationFrame(() => {
        const layoutHeight = Math.max(
          window.innerHeight,
          document.documentElement.clientHeight
        );
        const geometry = getMobileVisualViewportGeometry({
          layoutViewportHeight: layoutHeight,
          visualViewportHeight: visualViewport?.height ?? window.innerHeight,
          visualViewportOffsetTop: visualViewport?.offsetTop ?? 0,
        });

        setViewport({ layoutHeight, ...geometry });
      });
    };

    window.addEventListener("resize", measure);
    visualViewport?.addEventListener("resize", measure);
    visualViewport?.addEventListener("scroll", measure);
    measure();

    return () => {
      if (animationFrameId !== undefined) {
        window.cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener("resize", measure);
      visualViewport?.removeEventListener("resize", measure);
      visualViewport?.removeEventListener("scroll", measure);
    };
  }, [enabled]);

  return viewport;
};
