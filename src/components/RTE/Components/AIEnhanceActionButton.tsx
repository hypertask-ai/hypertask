import React from "react";
import { Pencil, Sparkles } from "lucide-react";
import { cn } from "@/utils/undoActions/helperFuncs";

interface IProps {
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onTouchEnd?: (e: React.TouchEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  id?: string;
}

const AIEnhanceActionButton: React.FC<IProps> = ({
  label,
  onClick,
  onTouchEnd,
  disabled,
  loading,
  className,
  id,
}) => {
  return (
    <span
      className={cn("ai-anim-border inline-flex rounded-sm", className)}
      aria-busy={loading}
    >
      <button
        id={id}
        aria-disabled={disabled || loading}
        aria-busy={loading}
        disabled={disabled || loading}
        onClick={onClick}
        onTouchEnd={onTouchEnd}
        className={cn(
          "relative border-thin border-transparent inline-flex p-[1px] items-center gap-2 px-2 py-2 text-meta rounded-sm select-none   transition-colors duration-200 ",
          loading ? "font-semibold text-icon-dark-gray " : "hover:bg-hypertasks-ai-purple/10 font-bold text-icon-dark-gray hover:border-purple-800"
        )}
      >
        {/* <span className="relative inline-flex items-center"> */}
        {/* <Pencil size={14} className="opacity-90" strokeWidth={1.75} /> */}
        <Sparkles size={16} className="opacity-80 " strokeWidth={1.75} />
        {/* </span> */}
        <span className="whitespace-nowrap">{label}</span>
      </button>
      <style jsx>{`
        .ai-anim-border {
          position: relative;
          padding: 1px;
        }
        .ai-anim-border::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: conic-gradient(
            from var(--ai-angle, 0deg),
            rgba(116,95,255,${loading ? "0.22" : "0"}),    /* Hypertask purple, much softer */
            rgba(232, 90, 180,${loading ? "0.13" : "0"}),  /* Slight pink, much softer */
            rgba(255, 221, 102,${loading ? "0.09" : "0"})  /* Yellowish tint, much softer */
          );
          animation: ${loading ? "aiColorSpin 5s linear infinite" : "none"};
          -webkit-mask: 
            linear-gradient(#000 0 0) content-box, 
            linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
          mask: 
            linear-gradient(#000 0 0) content-box, 
            linear-gradient(#000 0 0);
          mask-composite: exclude;
          /* Ensure the border effect is visible with 1.5px padding */
          padding: 1px;
          pointer-events: none;
        }
        @property --ai-angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }
        @keyframes aiColorSpin {
          to { --ai-angle: 360deg; }
        }
      `}</style>
    </span>
  );
};

export default AIEnhanceActionButton; 
