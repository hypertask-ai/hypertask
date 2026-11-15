import TooltipPortal from "./TooltipPortal";
import KBDElement from "./kbd";

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

const TopLayerTooltip = ({keyCombination,bottom, text,left, groupHoverId="",shouldReAdjustToViewport=true,portal=false,anchorRect=null,anchorElement=null}:Props) => (
    <TooltipPortal
      hover
      focus={portal}
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
          w-max max-w-[calc(100vw-16px)] py-[6px] px-2 whitespace-normal break-words text-dense xl:text-content absolute rounded-[4px]`}
      >
        <span className="min-w-0 break-words text-black">
          {text}
        </span>
        {keyCombination.length > 0 && <div>
          {keyCombination.map((key, index) => !key ?
            <span key={`then-${index}`} className="px-1 text-black">then</span> :
            <KBDElement key={`${key}-${index}`} content={key} className="px-1 font-semibold text-dense xl:text-content" />
          )}
        </div>}
      </div>
    </TooltipPortal>
);

const Tooltip = (props: Omit<Props, "keyCombination"> & {keyCombination: any[] | null}) => {
  const safeProps = {...props, keyCombination: props.keyCombination ?? []};
  return <TopLayerTooltip {...safeProps} />;
};

export default Tooltip;
