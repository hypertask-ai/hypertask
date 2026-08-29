import React from "react";
import Tooltip from "./Tooltip";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { cn } from "@/utils/undoActions/helperFuncs";

interface AIWriterButtonProps {
  /** Function to toggle the AI Task Writer */
  onToggle?: () => void;
  /** Unique identifier for the button element */
  id?: string;
  /** Additional CSS classes */
  className?: string;
  /** Button text - defaults to "ai" */
  text?: React.ReactNode;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Custom tooltip text - defaults to "Ai Task Writer" */
  tooltipText?: string;
  /** Custom keyboard shortcut - defaults to Ctrl/Cmd + J */
  customKeyCombination?: string[];
  /** Tooltip position adjustments */
  tooltipPosition?: {
    left?: number;
    bottom?: number;
  };
}

/**
 * Reusable AI Writer Button component
 * 
 * Features:
 * - Responsive keyboard shortcut (Ctrl+J on Windows/Linux, Cmd+J on Mac)
 * - Hover tooltip with keyboard shortcut display
 * - Customizable styling and behavior
 * - Disabled state support
 * 
 * @example
 * ```tsx
 * <AIWriterButton 
 *   onToggle={() => toggleAiTaskWriter()} 
 *   id="create-task-ai-writer" 
 * />
 * ```
 */
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
