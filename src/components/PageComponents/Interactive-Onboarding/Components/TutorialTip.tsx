import { useFlag } from "@/hooks/useFlag";
import { HTPR_6950_TOOLTIP_TOP_LAYER_FLAG } from "@/lib/flags/keys";
import { useEffect, useRef } from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import TooltipPortal from "@/components/Common/TooltipPortal";

interface Props {
  top: number;
  left: number;
  text: string;
  shouldReAdjustToViewport?: boolean;
  className?: string;
}

const LegacyTutorialTooltip = ({
  top,
  text,
  left,
  className,
  shouldReAdjustToViewport = true,
}: Props) => {
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shouldReAdjustToViewport) return;
    const tooltipElement = tooltipRef.current;

    if (tooltipElement) {
      const tooltipRect = tooltipElement.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      // Adjust left position if tooltip is going beyond the viewport
      if (tooltipRect.right > viewportWidth) {
        const newLeft = left - (tooltipRect.right - viewportWidth);
        tooltipElement.style.left = `${newLeft}px`;
      }
    }
  }, [left, shouldReAdjustToViewport]);

  return (
    <div
      ref={tooltipRef}
      style={{ top: top, left: left }}
      className={cn(
        "flex items-center z-[9990] font-normal border-light-black-border-1 border-[1px] bg-labelComponent gap-2  py-[6px] px-2 whitespace-nowrap text-meta xl:text-meta absolute   rounded-[4px]",
        className
      )}
    >
      <div className="inline-flex flex-wrap items-center gap-1">
        <span className="text-black whitespace-normal">{text}</span>
      </div>
    </div>
  );
};

const TopLayerTutorialTooltip = ({
  top,
  text,
  left,
  className,
  shouldReAdjustToViewport = true,
}: Props) => (
  <TooltipPortal adjustToViewport={shouldReAdjustToViewport}>
    <div
      style={{ top, left }}
      className={cn(
        "flex items-center font-normal border-light-black-border-1 border-[1px] bg-labelComponent gap-2 py-[6px] px-2 whitespace-nowrap text-meta xl:text-meta absolute rounded-[4px]",
        className,
      )}
    >
      <div className="inline-flex flex-wrap items-center gap-1">
        <span className="text-black whitespace-normal">{text}</span>
      </div>
    </div>
  </TooltipPortal>
);

const TutorialTooltip = (props: Props) => {
  const topLayer = useFlag(HTPR_6950_TOOLTIP_TOP_LAYER_FLAG);
  return topLayer ? <TopLayerTutorialTooltip {...props} /> : <LegacyTutorialTooltip {...props} />;
};

export default TutorialTooltip;
