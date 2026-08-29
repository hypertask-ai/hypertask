import { cn } from '@/utils/undoActions/helperFuncs';
import React, { ReactNode } from 'react'
import { ClassNameValue } from 'tailwind-merge';

const BackDropContainer = (
    {
        children,
        className
    }: {
        children: ReactNode,
        className?:ClassNameValue
    }
) => {
    return (
        <div
            style={{ outline: "none", zIndex: '300' }}
            // id="boardManager"
            tabIndex={-1}
            className={cn(className, "fixed backdrop h-SVH-full w-screen bg-black bg-opacity-25")}
        >
            {children}
        </div>
    )
}

export default BackDropContainer