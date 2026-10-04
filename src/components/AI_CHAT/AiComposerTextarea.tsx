import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/utils/undoActions/helperFuncs";

export const AiComposerTextarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn("block w-full resize-none bg-transparent py-2 text-dense outline-none placeholder:text-text-light-gray disabled:opacity-50", className)}
      {...props}
    />
  ),
);
AiComposerTextarea.displayName = "AiComposerTextarea";
