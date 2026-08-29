// bruhhhhhhhhh, this could be a single check, i was too dumb when writing it at first, it can be a single CHECK
// and just make variants of it via props. 
// please refactor when you see this
// fuck it, i'll just do it right now,

import { cn } from "@/utils/undoActions/helperFuncs";

interface ICheck {
    className?: string;
    variant: 'gray' | 'purple' | 'black';
    size?: number;
    strokeWidth?: number;
  }
  
  const Check: React.FC<ICheck> = ({
    className = "",
    variant,
    size = 17, // Default size
    strokeWidth = 1 // Default stroke width
  }) => {
    // Determine base color classes based on variant
    const baseColorClass = variant === 'gray' 
      ? 'text-[#777C85]' 
      : variant === 'purple' 
      ? 'text-[#C668FF]' 
      : 'text-white-black'; // Use white for dark theme
  
    return (
      <svg
        className={cn(className, baseColorClass)}
        width={size}
        height={(size * 13) / 17} // Maintain aspect ratio (17:13)
        viewBox="0 0 17 13"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M5.7 12.025L0 6.325L1.425 4.9L5.7 9.175L14.875 0L16.3 1.425L5.7 12.025Z"
          fill="currentColor" // Use currentColor for fill based on text color
          stroke="currentColor" // Use currentColor for stroke based on text color
          strokeWidth={strokeWidth}
        />
      </svg>
    );
  };

  
//   #262525
export const IconsGlobal={
    Check
}