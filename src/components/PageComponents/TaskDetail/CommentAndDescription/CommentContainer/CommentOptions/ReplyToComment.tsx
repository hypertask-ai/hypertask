import React from "react";
import { useMemo, useState } from "react";
import { Reply } from "lucide-react";
import { cn } from "@/utils/undoActions/helperFuncs";
import Tooltip from "@/components/Common/Tooltip";

interface IProps {
  onClickHandler: (currentIndex: number) => string | undefined;
  currentIndex: number;
}

const ReplyToComment: React.FC<IProps> = ({ onClickHandler, currentIndex }) => {
  const className = useMemo(
    () =>
      "cursor-pointer fill-icon-dark-gray hover:fill-white-black transition-[transform,fill] ease-in-out duration-100 scale-0 group-hover:scale-100 rounded-lg xs:mb-[5px] sm:mb-0",
    []
  );
  const [isHovered, setIsHovered] = useState(false);

  const onClick = (e: any) => {
    e.stopPropagation();
    onClickHandler(currentIndex);
  };
  return (
    <div
      className={"relative group"}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Reply size={14}
        className={cn(className, "text-content text-white-black")}
        onClick={onClick}
       strokeWidth={1.75}/>
      {isHovered && (
        <Tooltip
          left={0}
          bottom={-40}
          text="Reply to comment"
          keyCombination={["ENTER"]}
        />
      )}
    </div>
  );
};

export default ReplyToComment;
