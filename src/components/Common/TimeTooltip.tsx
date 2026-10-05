import { formatDateToGMT } from "@/utils/helperFunctions/helperFunctions";
import TooltipPortal from "./TooltipPortal";

interface Props {
    bottom:number;
    left:number;
    time:Date
}

const TimeTooltip = ({time,bottom, left}:Props) => (
    <TooltipPortal>
        <div
            style={{bottom, left}}
            className="sm:flex hidden items-center font-bold border-light-black-border-1 border-[1px] bg-labelComponent gap-2 py-2 px-2 whitespace-nowrap text-content absolute sm:scale-100 scale-0 rounded-[4px]"
        >
            <span className="text-black text-meta">
                {formatDateToGMT(time)}
            </span>
        </div>
    </TooltipPortal>
);

export default TimeTooltip;
