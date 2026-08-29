import React, { useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import Tooltip from "@/components/Common/Tooltip";

interface IProps {
  onClickHandler: (currentIndex: number) => void;
  currentIndex: number;
}

const EditCommentButton: React.FC<IProps> = ({ onClickHandler, currentIndex }) => {
  const className = useMemo(
    () =>
      "cursor-pointer text-icon-dark-gray hover:text-white-black transition-[transform,color] ease-in-out duration-100 scale-0 group-hover:scale-100 rounded-lg xs:mb-[5px] sm:mb-0",
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
      <Pencil size={14} className={className} onClick={onClick} strokeWidth={1.75} />
      {isHovered && (
        <Tooltip left={0} bottom={-40} text="Edit comment" keyCombination={[]} />
      )}
    </div>
  );
};

export default EditCommentButton;
