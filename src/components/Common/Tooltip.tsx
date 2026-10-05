import TooltipPortal from "./TooltipPortal";

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

const Tooltip = ({keyCombination,bottom, text,left, groupHoverId="",shouldReAdjustToViewport=true,portal=false,anchorRect=null,anchorElement=null}:Props) => (
    <TooltipPortal
      hover
      groupHoverId={groupHoverId}
      anchorRect={anchorRect}
      anchorElement={anchorElement}
      placement={portal ? "below" : "inline"}
      adjustToViewport={shouldReAdjustToViewport}
    >
      <div
        style={portal ? {left: 0, top: 0} : {bottom, left}}
        className={`sm:flex hidden items-center font-semibold
          border-light-black-border-1 border-[1px] bg-labelComponent gap-2
          max-w-[calc(100vw-16px)] py-[6px] px-2 text-dense xl:text-content absolute rounded-[4px]
          ${portal ? "whitespace-normal break-words" : "whitespace-nowrap"}`}
      >
        <span className={portal ? "min-w-0 break-words text-black" : "text-black"}>
          {text}
        </span>
        {keyCombination.length > 0 && <div>
          {keyCombination.map((key) => !key ?
            <span key={"then"} className="px-1 text-black">then</span> :
            <kbd
              key={key}
              className="px-1 pt-[2px] mx-[1.5px] rounded-[2px] pb-0 border-gray-200 bg-[#555B64] dark:border-gray-500"
            >
              {key}
            </kbd>
          )}
        </div>}
      </div>
    </TooltipPortal>
);

export default Tooltip;
