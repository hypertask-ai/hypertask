// components/SelectionCheckbox.tsx

import { cn } from '@/utils/undoActions/helperFuncs';
import { FC, type MouseEvent } from 'react';

interface SelectionCheckboxProps {
  id?: any;
  isChecked: boolean;
  onClick: (id: any, event?: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  size?: number;
  alwaysVisible?: boolean;
  groupName?: string; // NEW — to customize group context
  checkmarkColorClass?: string;
  borderColorClass?: string;
}

const SelectionCheckbox: FC<SelectionCheckboxProps> = ({
  id,
  isChecked,
  onClick,
  className,
  size = 15,
  alwaysVisible = true, 
  groupName = 'selection_row', 
  checkmarkColorClass = 'text-white-black',
  borderColorClass = '!border-white',
}) => { 
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClick(id, e);
  };

  const visibilityClass = alwaysVisible
    ? 'visible'
    : `group-hover/${groupName}:!visible !invisible`;

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={isChecked ? 'Deselect item' : 'Select item'}
      onClick={handleClick}

      className={cn(
        'relative  items-center justify-center ease-in-out hidden sm:flex',
        '!border !border-opacity-60 rounded-sm',
        borderColorClass,
        visibilityClass,
        className
      )}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,

      }}
    >
      {isChecked && (
        <svg width="9" height="7" viewBox="0 0 12 9" fill="none" className={checkmarkColorClass}>
          <path
            d="M1 4.5L4.5 8L11 1.5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
};

export default SelectionCheckbox;
