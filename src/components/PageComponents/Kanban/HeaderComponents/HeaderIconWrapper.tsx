import React, { ReactNode } from "react";
import { cn } from "@/utils/undoActions/helperFuncs";

interface HeaderIconWrapperProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  id?: string;
}

/**
 * Reusable wrapper for header icon components in the Kanban header.
 * Provides consistent styling with hover effects and cursor pointer.
 */
const HeaderIconWrapper: React.FC<HeaderIconWrapperProps> = ({
  id,
  children,
  onClick,
  className,
}) => {
  return (
    <div
      className={cn(
        "board-header-icon flex text-white-black group-hover:text-header-hover-text gap-1 items-center cursor-pointer relative group",
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

export default HeaderIconWrapper;
