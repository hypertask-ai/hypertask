import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
    bottom:number;
    left:number;
    text:string;
    keyCombination:any[];
    groupHoverId?:string;
    shouldReAdjustToViewport?:boolean
    portal?:boolean;
    anchorRect?:DOMRect | null;
    anchorElement?:HTMLElement | null;
  }


const Tooltip = ({keyCombination,bottom, text,left, groupHoverId="",shouldReAdjustToViewport=true,portal=false,anchorRect=null,anchorElement=null}:Props) => {
    const tooltipRef = useRef<HTMLDivElement>(null);
    const portalAnchorRef = useRef<HTMLSpanElement>(null);
    const [hoveredAnchor, setHoveredAnchor] = useState<HTMLElement | null>(null);
    const [liveAnchorRect, setLiveAnchorRect] = useState<DOMRect | null>(anchorRect);
    const resolvedAnchor = anchorElement ?? hoveredAnchor;

    useEffect(() => {
      if (!portal || anchorElement || anchorRect) return;

      const anchor = portalAnchorRef.current?.parentElement;
      if (!anchor) return;

      const show = () => setHoveredAnchor(anchor);
      const hide = () => setHoveredAnchor(null);
      anchor.addEventListener("mouseenter", show);
      anchor.addEventListener("mouseleave", hide);
      anchor.addEventListener("focusin", show);
      anchor.addEventListener("focusout", hide);

      return () => {
        anchor.removeEventListener("mouseenter", show);
        anchor.removeEventListener("mouseleave", hide);
        anchor.removeEventListener("focusin", show);
        anchor.removeEventListener("focusout", hide);
      };
    }, [anchorElement, anchorRect, portal]);

    useEffect(() => {
      if (!portal) return;

      const updateAnchorRect = () => {
        setLiveAnchorRect(resolvedAnchor?.getBoundingClientRect() ?? anchorRect);
      };
      updateAnchorRect();
      if (!resolvedAnchor) return;

      window.addEventListener("scroll", updateAnchorRect, true);
      window.addEventListener("resize", updateAnchorRect);
      return () => {
        window.removeEventListener("scroll", updateAnchorRect, true);
        window.removeEventListener("resize", updateAnchorRect);
      };
    }, [anchorRect, portal, resolvedAnchor]);

    useEffect(() => {
      if (!portal || !liveAnchorRect)return
      const tooltipElement = tooltipRef.current;

      if (tooltipElement) {
        const tooltipRect = tooltipElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const leftPosition = Math.max(8, Math.min(liveAnchorRect.left, viewportWidth - tooltipRect.width - 8));
        const belowTop = liveAnchorRect.bottom + 8;
        const topPosition = belowTop + tooltipRect.height > viewportHeight
          ? liveAnchorRect.top - tooltipRect.height - 8
          : belowTop;

        tooltipElement.style.left = `${leftPosition}px`;
        tooltipElement.style.top = `${Math.max(0, Math.min(topPosition, viewportHeight - tooltipRect.height))}px`;
      }
    }, [liveAnchorRect, portal]);

    useEffect(() => {
      if (portal || !shouldReAdjustToViewport)return
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
    const groupHoverCN = `group-hover`+groupHoverId+`:scale-100`

    if (portal) {
      const anchorMarker = anchorElement || anchorRect ? null : (
        <span ref={portalAnchorRef} aria-hidden="true" className="hidden" />
      );
      if (typeof document === 'undefined' || !liveAnchorRect) return anchorMarker;

      return <>
        {anchorMarker}
        {createPortal(
            <div
            ref={tooltipRef}
                style={{left:liveAnchorRect.left, top:liveAnchorRect.bottom + 8}}
                className={`sm:flex
                    hidden
                    items-center
                    z-[9999]
                    font-semibold
                    border-light-black-border-1 border-[1px]
                    bg-labelComponent gap-2 max-w-[calc(100vw-16px)]

                    py-[6px] px-2 whitespace-normal break-words text-dense xl:text-content fixed
                    rounded-[4px]
                     `}>
                <span className="min-w-0 break-words text-black">
                    {text}
                </span>
                {keyCombination.length> 0 && <div>
                  {
                    keyCombination.map((key)=>

                    !key?
                      <span key={"then"} className= "px-1 text-black">
                          then
                      </span>
                      :

                      <kbd
                        key={key}
                          className={`px-1 pt-[2px] mx-[1.5px] rounded-[2px] pb-0 border-gray-200
                              bg-[#555B64]  dark:border-gray-500`}
                          >
                          {key}
                      </kbd>


                    )
                  }
                </div>}
            </div>,
            document.body
        )}
      </>
    }

    return(
            <div
            ref={tooltipRef}
                style={{bottom:bottom, left:left}}
                className={`sm:flex
                    hidden 
                    items-center
                    z-[9999]
                    font-semibold
                    border-light-black-border-1 border-[1px]
                    bg-labelComponent gap-2 

                    py-[6px] px-2 whitespace-nowrap text-dense xl:text-content absolute  
                    sm:scale-0 ${groupHoverCN} rounded-[4px]
                     `}>
                <span className=" text-black">
                    {text}
                </span>
                {keyCombination.length> 0 && <div>
                  {
                    keyCombination.map((key)=>
                    
                    !key?
                      <span key={"then"} className= "px-1 text-black">
                          then
                      </span>
                      :
                      
                      <kbd
                        key={key}
                          className={`px-1 pt-[2px] mx-[1.5px] rounded-[2px] pb-0 border-gray-200 
                              bg-[#555B64]  dark:border-gray-500`}
                          >
                          {key}
                      </kbd>
                    
                    
                    )
                  }
                </div>}
            </div>
        
    )
}

export default Tooltip
