
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
    size = 17,
    strokeWidth = 1
  }) => {
    const baseColorClass = variant === 'gray' 
      ? 'text-[#777C85]' 
      : variant === 'purple' 
      ? 'text-[#C668FF]' 
      : 'text-white-black';
  
    return (
      <svg
        className={cn(className, baseColorClass)}
        width={size}
        height={(size * 13) / 17}
        viewBox="0 0 17 13"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M5.7 12.025L0 6.325L1.425 4.9L5.7 9.175L14.875 0L16.3 1.425L5.7 12.025Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={strokeWidth}
        />
      </svg>
    );
  };

  
export const IconsGlobal={
    Check
}