import React, { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/utils/undoActions/helperFuncs";
import Tooltip from "@/components/Common/Tooltip";
import { IComment } from "@/models/model";
import { useCommentToAiChat } from "@/hooks/MultiPages/AIChat/useCommentToAiChat";

const SummarizeComment: React.FC<{ comment: IComment }> = ({ comment }) => {
  const className = useMemo(
    () =>
      "cursor-pointer text-icon-dark-gray hover:text-white-black transition-[transform,color] ease-in-out duration-100 scale-0 group-hover:scale-100 rounded-lg xs:mb-[5px] sm:mb-0",
    []
  );
  const [isHovered, setIsHovered] = useState(false);
  const { summarizeComment } = useCommentToAiChat();

  const onClick = (e: any) => {
    e.stopPropagation();
    void summarizeComment(comment);
  };

  return (
    <div
      className={"relative group"}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Sparkles size={14} className={className} onClick={onClick} strokeWidth={1.75} />
      {isHovered && (
        <Tooltip left={0} bottom={-40} text="Summarize comment" keyCombination={[]} />
      )}
    </div>
  );
};

export default SummarizeComment;
