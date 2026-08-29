import { formatDateToGMT } from "@/utils/helperFunctions/helperFunctions";
import { useEffect, useRef } from "react";

interface Props {
    bottom:number;
    left:number;
    time:Date
  }


const TimeTooltip = ({time,bottom, left}:Props) => {
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
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
    }, [left]);



    return(
            <div
            ref={tooltipRef}
                style={{bottom:bottom, left:left}}
                className={`sm:flex
                    hidden 
                    items-center
                    z-[9999]
                    font-bold
                    border-light-black-border-1 border-[1px]
                    bg-labelComponent gap-2 
                    py-2 px-2 whitespace-nowrap text-content absolute  
                    sm:scale-100 scale-0    rounded-[4px]
                     `}>
                <span className="text-black text-meta">
                  {formatDateToGMT(time)}
                </span>
               
            </div>
        
    )
}

export default TimeTooltip
