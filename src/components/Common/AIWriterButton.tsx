import React from "react";
import Tooltip from "./Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { cn } from "@/utils/undoActions/helperFuncs";

interface AIWriterButtonProps {
  onToggle?: () => void;
  id?: string;
  className?: string;
  text?: React.ReactNode;
  disabled?: boolean;
  tooltipText?: string;
  customKeyCombination?: string[];
  tooltipPosition?: {
    left?: number;
    bottom?: number;
  };
}

const AIWriterButton: React.FC<AIWriterButtonProps> = ({
  onToggle,
  id,
  className,
  text = "ai",
  disabled = false,
  tooltipText = "Ai Task Writer",
  customKeyCombination,
  tooltipPosition = { left: 0, bottom: -45 }
}) => {
  const isApple = useDeviceContext();
  const ctrlCmd = isApple ? "CMD" : "CTRL";
  const keyCombination = customKeyCombination || [ctrlCmd, "J"];

  const handleClick = () => {
    if (!disabled && onToggle) {
      onToggle();
    }
  };

  return (
    <span className="relative group">
      <span
        className={cn(
          "text-hypertasks-ai-purple ml-auto text-emphasis cursor-pointer",
          "hover:opacity-80 transition-opacity duration-200",
          disabled && "opacity-50 cursor-not-allowed",
          className
        )}
        id={id}
        onClick={handleClick}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            handleClick();
          }
        }}
        aria-label={tooltipText}
        aria-disabled={disabled}
      >
        {text}
      </span>
      <Tooltip
        left={tooltipPosition.left!}
        bottom={tooltipPosition.bottom!}
        keyCombination={keyCombination}
        text={tooltipText}
      />
    </span>
  );
};

export default AIWriterButton;
