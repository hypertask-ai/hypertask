import { cn } from "@/utils/undoActions/helperFuncs";
import { HTMLAttributes, ReactNode } from "react";
import TooltipPortal from "./TooltipPortal";

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  groupHoverId?: string;
  shouldReAdjustToViewport?: boolean;
  setPosition?: boolean;
}

const ReactTooltip = ({
  groupHoverId = "",
  shouldReAdjustToViewport = true,
  children,
  className,
  setPosition = true,
}: Props) => (
  <TooltipPortal hover={!className?.split(/\s+/).includes("scale-100")} groupHoverId={groupHoverId} adjustToViewport={shouldReAdjustToViewport}>
    {(rect) => {
      const showAbove = rect.top >= 190;
      return <div
        data-hover-tooltip-content
        style={{
          bottom: setPosition ? (showAbove ? 35 : undefined) : 10,
          top: setPosition && !showAbove ? "calc(100% + 10px)" : undefined,
          left: "50%",
          translate: "-50%",
        }}
        className={cn(
          `bg-[#ffff] dark:bg-[#1A1D21] hidden sm:flex sm:flex-col gap-2 items-center absolute text-wrap text-white-black
          sm:w-[200px] text-center text-dense py-3 px-2 rounded-md cursor-pointer
          shadow-lg scale-100 transition-transform duration-100
          ${showAbove
            ? "before:content-[''] before:absolute before:top-full before:left-1/2 before:-translate-x-1/2 before:border-8 before:border-transparent before:border-t-white dark:before:border-t-[#1A1D21]"
            : "after:content-[''] after:absolute after:bottom-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-white dark:before:border-t-[#1A1D21]"
          }`,
          className,
        )}
      >
        {children}
      </div>;
    }}
  </TooltipPortal>
);

export default ReactTooltip;
