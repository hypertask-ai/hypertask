// components/LabelWrapper.tsx
import React, { HTMLAttributes } from 'react';
import { cn } from '@/utils/undoActions/helperFuncs';

interface LabelWrapperProps extends HTMLAttributes<HTMLDivElement> {
    px?: number;
    py?: number;
    flexBasis?: boolean;
    ref?: any
}

const LabelWrapper: React.FC<LabelWrapperProps> = ({
    children,
    px = 6,
    py = 2,
    flexBasis = false,
    style,
    className='',
    ...props
}) => {
    return (
        <div
            {...props}
            style={{
                fontSize: 12,
                fontWeight: 500,
                padding: `${py}px ${px}px`,
                ...style,
            }}
            ref={props.ref}
            className={cn(
                `inline-flex gap-1.5 items-center
                    min-h-[20px]
                    label-pill bg-label-span rounded-sm
                    w-fit max-w-full
                    leading-none
                    text-white-black`,
                className,
                flexBasis && 'basis-full',
            )}
        >
            {children}
        </div>
    );
};

export default LabelWrapper;
