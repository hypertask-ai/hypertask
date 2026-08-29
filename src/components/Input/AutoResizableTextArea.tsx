import useAutosizeTextArea from "@/hooks/General/useAutosizeTextarea"
import { cn } from "@/utils/undoActions/helperFuncs"
import React, { useRef, useEffect } from "react"

interface AutoResizingTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  minRows?: number
  maxHeight?: number
}

export const AutoResizingTextarea: React.FC<AutoResizingTextareaProps> = ({
  value,
  onChange,
  placeholder = "",
  autoFocus = false,
  className = "",
  minRows = 5,
  ...rest
}) => {
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  useAutosizeTextArea(textAreaRef.current, value)

  return (
    <textarea
      ref={textAreaRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      rows={minRows}
      className={cn(
        "scrollbar-thin scrollbar-track-transparent overflow-auto resize-none outline-none border-thin border-opacity-10 rounded p-3 border-gray-50",
        className
      )}
      {...rest}
    />
  )
}
