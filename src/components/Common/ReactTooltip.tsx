import { cn } from "@/utils/undoActions/helperFuncs";
import { HTMLAttributes, ReactNode, useEffect, useRef, useState } from "react";

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

  const groupHoverCN = `group-hover` + groupHoverId + `:scale-100`;

  return (
    <div
      ref={tooltipRef}
      style={{
        bottom:
          setPosition && setPosition === true
            ? showAbove
              ? 35
              : offset.y
            : 10,
        left: offset.x,
        //transform: `translate(${offset.x}px, ${offset.y}px)`,
      }}
      className={cn(
        `bg-[#ffff]  dark:bg-[#1A1D21] hidden sm:flex sm:flex-col gap-2 items-center z-[9999] absolute text-wrap text-white-black
        sm:w-[200px] text-center text-dense  py-3 px-2 rounded-md cursor-pointer
         shadow-lg scale-0 ${groupHoverCN} transition-transform duration-100
        ${
          showAbove
            ? "before:content-[''] before:absolute before:top-full before:left-1/2 before:-translate-x-1/2 before:border-8 before:border-transparent before:border-t-white dark:before:border-t-[#1A1D21]"
            : "after:content-[''] after:absolute after:bottom-full after:left-1/2 after:-translate-x-1/2 after:border-8 after:border-transparent after:border-t-white dark:before:border-t-[#1A1D21]"
        } 
      `,
        className
      )}
    >
      {children}
    </div>
  );
};

export default ReactTooltip;
