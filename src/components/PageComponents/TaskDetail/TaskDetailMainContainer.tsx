import { MobileViewContext } from '@/lib/contexts/mobileContext';
import React, { ReactNode, useContext, useRef } from 'react'
interface IPageContainer {
  children?: ReactNode;
  bodyClassName?: string;

}
const TaskDetailMainContainer: React.FC<IPageContainer> = ({ children, bodyClassName = "" }) => {
  const scrollContainer = useRef<HTMLDivElement | null>(null);
  const _mbl = useContext(MobileViewContext);
  return (
    <div
      ref={scrollContainer}
      className={`
        ${_mbl  
          ? "@container bg-taskDetailPage flex flex-col w-full min-h-screen items-center"
          : "@container flex min-w-0 w-full items-center justify-center flex-col min-h-screen bg-taskDetailPage"
        }`}
    >

      <div
        id="body"
        className={`
        ${bodyClassName}
        ${_mbl
            ? "bg-taskDetal-container flex flex-col no-scrollbar scrollbar-none w-full  min-h-screen "
            : "w-full min-w-0 min-h-screen flex flex-col items-start space-y-4 bg-taskDetal-container max-w-[71rem] mx-auto"
          }`}
      >
        {children}
      </div>
    </div>


  )
}

export default TaskDetailMainContainer
