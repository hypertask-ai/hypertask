import { useEffect, useState } from "react";
import {
  getMobileVisualViewportGeometry,
  parseCssPixelLength,
  type MobileVisualViewportGeometry,
} from "@/lib/mobileCommentViewport";

export interface MobileVisualViewportState
  extends MobileVisualViewportGeometry {
  layoutHeight: number;
  dockHeight: number;
}

export const useMobileVisualViewport = (enabled = true) => {
  const [viewport, setViewport] = useState<MobileVisualViewportState | null>(
    null
  );

  useEffect(() => {
    if (!enabled) return;

    const visualViewport = window.visualViewport;
    let animationFrameId: number | undefined;
    const requestFrame = window.requestAnimationFrame?.bind(window);
    const cancelFrame = window.cancelAnimationFrame?.bind(window);

    const measure = () => {
      if (animationFrameId !== undefined) cancelFrame?.(animationFrameId);

      const apply = () => {
        const layoutHeight = Math.max(
          window.innerHeight,
          document.documentElement.clientHeight
        );
        const geometry = getMobileVisualViewportGeometry({
          layoutViewportHeight: layoutHeight,
          visualViewportHeight: visualViewport?.height ?? window.innerHeight,
          visualViewportOffsetTop: visualViewport?.offsetTop ?? 0,
        });
        const dockHeight = parseCssPixelLength(
          window.getComputedStyle(document.documentElement).getPropertyValue(
            "--mobile-dock-h",
          ),
        );

        setViewport({ layoutHeight, dockHeight, ...geometry });
      };

      if (requestFrame) animationFrameId = requestFrame(apply);
      else apply();
    };

    window.addEventListener("resize", measure);
    visualViewport?.addEventListener("resize", measure);
    visualViewport?.addEventListener("scroll", measure);
    measure();

    return () => {
      if (animationFrameId !== undefined) cancelFrame?.(animationFrameId);
      window.removeEventListener("resize", measure);
      visualViewport?.removeEventListener("resize", measure);
      visualViewport?.removeEventListener("scroll", measure);
    };
  }, [enabled]);

  return viewport;
};
