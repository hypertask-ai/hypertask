import { useFlag } from "@/hooks/useFlag";
import { HTPR_6950_TOOLTIP_TOP_LAYER_FLAG } from "@/lib/flags/keys";
import { cn } from "@/utils/undoActions/helperFuncs";
import { HTMLAttributes, ReactNode, Ref, useEffect, useRef, useState } from "react";
import TooltipPortal from "./TooltipPortal";

interface Props extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  groupHoverId?: string;
  shouldReAdjustToViewport?: boolean;
  setPosition?: boolean;
}

const LegacyReactTooltip = ({
  groupHoverId = "",
  shouldReAdjustToViewport = true,
  children,
  className,
  setPosition = true,
}: Props) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showAbove, setShowAbove] = useState(false);

  useEffect(() => {
    if (tooltipRef.current) {
      const parentRect =
        tooltipRef.current.parentElement?.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();

      if (parentRect) {
        const ifAboveSpace = parentRect.top >= 190;
        setShowAbove(ifAboveSpace);
        const xOffset = (parentRect.width - tooltipRect.width) / 2;
        setOffset({
          x: xOffset,
          y: -tooltipRect.height - 10, // 10px gap above parent
        });
      }
    }
  }, []);

  useEffect(() => {
    if (!shouldReAdjustToViewport) return;
    const tooltipElement = tooltipRef.current;

    if (tooltipElement) {
      const tooltipRect = tooltipElement.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      // Adjust left position if tooltip is going beyond the viewport
      if (tooltipRect.right > viewportWidth) {
        const newLeft = offset.x - (tooltipRect.right - viewportWidth);
        tooltipElement.style.left = `${newLeft}px`;
      }
    }
  }, [shouldReAdjustToViewport, offset]);

  return <ReactTooltipContent
    {...{ groupHoverId, children, className, showAbove }}
    tooltipRef={tooltipRef}
    style={{ bottom: setPosition ? (showAbove ? 35 : offset.y) : 10, left: offset.x }}
  />;
};

const ReactTooltipContent = ({
  groupHoverId = "", children, className, showAbove, topLayer = false, tooltipRef, style,
}: Props & { showAbove: boolean; topLayer?: boolean; tooltipRef?: Ref<HTMLDivElement> }) => (
  <div
    ref={tooltipRef}
    data-hover-tooltip-content={topLayer || undefined}
    style={style}
    className={cn(
      `bg-[#ffff] dark:bg-[#1A1D21] hidden sm:flex sm:flex-col gap-2 items-center ${topLayer ? "" : "z-[9999]"} absolute text-wrap text-white-black
      sm:w-[200px] text-center text-dense py-3 px-2 rounded-md cursor-pointer
      shadow-lg ${topLayer ? "scale-100" : `scale-0 group-hover${groupHoverId}:scale-100`} transition-transform duration-100
      ${showAbove
        ? "before:content-[''] before:absolute before:top-full before:left-1/2 before:-translate-x-1/2 before:border-8 before:border-transparent before:border-t-white dark:before:border-t-[#1A1D21]"
        : "after:content-[''] after:absolute after:bottom-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-white dark:before:border-t-[#1A1D21]"
      }`,
      className,
    )}
  >
    {children}
  </div>
);

const TopLayerReactTooltip = ({
  groupHoverId = "",
  shouldReAdjustToViewport = true,
  children,
  className,
  setPosition = true,
}: Props) => (
  <TooltipPortal hover={!className?.split(/\s+/).includes("scale-100")} groupHoverId={groupHoverId} adjustToViewport={shouldReAdjustToViewport}>
    {(rect) => {
      const showAbove = rect.top >= 190;
      return <ReactTooltipContent
        {...{ children, className, showAbove }}
        topLayer
        style={{
          bottom: setPosition ? (showAbove ? 35 : undefined) : 10,
          top: setPosition && !showAbove ? "calc(100% + 10px)" : undefined,
          left: "50%",
          translate: "-50%",
        }}
      />;
    }}
  </TooltipPortal>
);

const ReactTooltip = (props: Props) => {
  const topLayer = useFlag(HTPR_6950_TOOLTIP_TOP_LAYER_FLAG);
  return topLayer ? <TopLayerReactTooltip {...props} /> : <LegacyReactTooltip {...props} />;
};

export default ReactTooltip;
