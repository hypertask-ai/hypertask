import React, { FC, ReactNode, RefObject, useContext } from 'react'
import { MobileViewContext } from '@/lib/contexts/mobileContext'
import { cn } from '@/utils/undoActions/helperFuncs';


interface BaseCommentAndDescriptionContainerProps {
  children: ReactNode;
  ref?: RefObject<HTMLDivElement | null>;
  showScrollToTop?: boolean;
  className?: string;
}
const BaseCommentAndDescriptionContainer:FC<BaseCommentAndDescriptionContainerProps> = ({children, ref, showScrollToTop = false, className}) => {
  const _mbl = useContext(MobileViewContext);
    return (
    <div
      ref={ref}
      style={{ flex: 1 }}
      className={cn(`
        scrollbar-none no-scrollbar
        ${
          _mbl
            ? `w-full pb-[50px] ${showScrollToTop ? "xs:!pb-[100px]" : "xs:!pb-[50px]"}`
            : " flex flex-col min-w-[500px] max-w-[680px] pb-[40px] "
        }`, className)}
    >
      {children}
    </div>
  )
}

export default BaseCommentAndDescriptionContainer