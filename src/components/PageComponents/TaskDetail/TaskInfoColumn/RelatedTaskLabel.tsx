import Tooltip from "@/components/Common/Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { useRouter } from "next/navigation";
import React, { useRef, useState } from "react";
import { X } from "lucide-react";

const RelatedTaskLabel = ({
  onClick,
  relationInfo,
}: {
  onClick: (relationId: number) => void;
  relationInfo: {
    title: string;
    ticketNumber: string;
    route: string;
    id: number;
  };
}) => {
  const { title, ticketNumber, id, route } = relationInfo;
  const [hover, setHover] = useState<boolean>(false);
  const labelRef = useRef<HTMLDivElement>(null);
  const isMbl = useDeviceContext();
  const router = useRouter();
  const handleOnClick = (e: any) => {
    e.preventDefault();
    // stopPropogation && e.stopPropagation();
    onClick(id);
  };

  const goToTask = (e: React.MouseEvent) => {
    // Let cmd/ctrl/shift + click (and middle-click via the native anchor)
    // open a new browser tab; only intercept a plain left-click for SPA nav.
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    router.push(route);
  };

  return (
    <div
      className={`flex gap-1.5 w-full min-w-0 items-center min-h-[20px] rounded-sm text-meta leading-5 text-[#8E9093] relative group`}
      ref={labelRef}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <a
        href={route}
        onClick={goToTask}
        className={`block min-w-0 flex-1 overflow-hidden whitespace-nowrap text-ellipsis cursor-pointer no-underline text-inherit`}
      >
        <span className="text-label-component font-medium">{ticketNumber}</span>
        {title && <span className="ml-1 text-[#8E9093]">{title}</span>}
      </a>
      {hover && (
        <Tooltip
          portal
          anchorElement={labelRef.current}
          left={0}
          bottom={25}
          text={title}
          keyCombination={[]}
        />
      )}
      {isMbl ? (
        <X
          size={16}
          className="cursor-pointer hover:text-[#95999E] text-[#8E9093]"
          onClick={handleOnClick}
         strokeWidth={1.75}/>
      ) : (
        hover && (
          <X
            size={16}
            className="cursor-pointer hover:text-[#95999E] text-[#8E9093]"
            onClick={handleOnClick}
           strokeWidth={1.75}/>
        )
      )}
    </div>
  );
};

export default RelatedTaskLabel;
