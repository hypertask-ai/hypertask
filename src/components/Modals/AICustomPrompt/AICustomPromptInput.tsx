import useAutosizeTextArea from "@/hooks/General/useAutosizeTextarea";
import { CustomAIPromptContext } from "@/lib/contexts/Multipages/customAiInstructionContext";
import React, { useContext, useRef } from "react";

interface AICustomPromptInputProps {
  fillHeight?: boolean;
  value?: string;
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>;
  id?: string;
  readOnly?: boolean;
  placeholder?: string;
}

const AICustomPromptInput = ({
  fillHeight = false,
  value: controlledValue,
  onChange,
  id,
  readOnly,
  placeholder = "e.g. Keep the responses concise",
}: AICustomPromptInputProps) => {
  const context = useContext(CustomAIPromptContext);
  if (controlledValue === undefined && context === undefined) {
    throw new Error("useCustomAiInstructions must be used within a CustomAiProvider");
  }
  const value = controlledValue ?? context!.value;
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
        id={id}
        readOnly={readOnly}
        placeholder={placeholder}
        className={`w-full resize-y overflow-auto rounded-[4px] bg-active-modal-element p-3 text-dense text-white-black outline-none placeholder:text-text-light-gray scrollbar-thin scrollbar-track-transparent ${
          fillHeight ? "h-full min-h-0 flex-1" : "min-h-[180px]"
        }`}
        value={value}
        onChange={onChange ?? context?.handleChange}
      />
    </div>
  );
};

export default AICustomPromptInput;
