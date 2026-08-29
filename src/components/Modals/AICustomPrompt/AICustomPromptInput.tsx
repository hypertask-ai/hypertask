import useAutosizeTextArea from "@/hooks/General/useAutosizeTextarea";
import { useCustomAiInstructions } from "@/lib/contexts/Multipages/customAiInstructionContext";
import React, { useRef } from "react";

interface AICustomPromptInputProps {
  fillHeight?: boolean;
}

const AICustomPromptInput = ({
  fillHeight = false,
}: AICustomPromptInputProps) => {
  const { handleChange, value } = useCustomAiInstructions();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useAutosizeTextArea(fillHeight ? null : textAreaRef.current, value);

  return (
    <div
      className={`flex min-w-full flex-grow px-2 ${
        fillHeight ? "min-h-0 flex-1" : ""
      }`}
    >
      <textarea
        ref={textAreaRef}
        placeholder="e.g. Keep the responses concise"
        className={`w-full resize-y overflow-auto rounded-[4px] bg-active-modal-element p-3 text-dense text-white-black outline-none placeholder:text-text-light-gray scrollbar-thin scrollbar-track-transparent ${
          fillHeight ? "h-full min-h-0 flex-1" : "min-h-[180px]"
        }`}
        value={value}
        onChange={handleChange}
      />
    </div>
  );
};

export default AICustomPromptInput;
