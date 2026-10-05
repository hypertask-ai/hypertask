import { cn } from "@/utils/undoActions/helperFuncs";
import TooltipPortal from "@/components/Common/TooltipPortal";

interface Props {
  top: number;
  left: number;
  text: string;
  shouldReAdjustToViewport?: boolean;
  className?: string;
}

const TutorialTooltip = ({
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

export default TutorialTooltip;
