import ReactTooltip from "@/components/Common/ReactTooltip";
import NativeEmoji from "./NativeEmoji";
import React from "react";

interface IProps {
  unified: string;
  text: string;
  semantic: string;
  tooltipClassName?: string;
  setPosition?: boolean;
}
const EmojiTooltip = ({ unified, text, semantic, tooltipClassName, setPosition = true }: IProps) => {
  return (
    <ReactTooltip className={tooltipClassName} setPosition={setPosition}>
      <div className="p-1 bg-white rounded">
        <NativeEmoji unified={unified} size={45} />
      </div>
      <div className="inline font-medium text-center">
        {text}
        <span className="font-normal text-text-light-gray">{` reacted with ${semantic}`}</span>
      </div>
    </ReactTooltip>
  );
};

export default EmojiTooltip;
