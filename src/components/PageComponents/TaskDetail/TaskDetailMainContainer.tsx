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
            // HTPR-5513: no bottom padding here. This element is the sticky
            // properties rail's *ancestor*, not its containing block — padding
            // below the rail's row pushes the rail up by that much once you
            // reach the end of the thread, so the properties scrolled out of
            // view and could not be scrolled back. The same trailing space now
            // lives inside the comments column (see CommentAndDescription).
            : "w-full min-w-0 min-h-screen flex flex-col items-start space-y-4 bg-taskDetal-container max-w-[71rem] mx-auto"
          }`}
      >
        {children}
      </div>
    </div>


  )
}

export default TaskDetailMainContainer
