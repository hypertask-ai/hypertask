import React, { useContext } from "react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { cn } from "@/utils/undoActions/helperFuncs";

export interface TaskInfoValueProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
}

export const TaskInfoValue: React.FC<TaskInfoValueProps> = ({
  children,
  className,
  style,
  ...rest
}) => {
  const _mbl = useContext(MobileViewContext);

  return (
    <div
      style={{ width: "100%", position: "relative", ...style }}
      className={cn(_mbl ? "w-full min-w-0" : "ml-[20px] w-full min-w-0", className)}
      {...rest}
    >
      {children}
    </div>
  );
};
