import React from 'react';

import Markdown from 'react-markdown'
import "@/styles/task/taskSummary.scss"
import Tooltip from '@/components/Common/Tooltip';
import { ChevronDown } from "lucide-react";
import { useTaskContext } from "@/lib/contexts/TaskDetail/TaskProvider";
import useClickOutside from '@/hooks/MultiPages/useClickOutside';
import { summaryTeaser } from "@/utils/summaryTeaser";

interface Props{
    taskSummary:string
}
const  TaskSummary:React.FC<Props> = ({taskSummary:markdown})=> {
 
  // const markdown = `
  // - Task involves developing AI-generated summaries for each task. 
  // - Initial drafts and testing are being conducted using GPT-4 model.
  // `
  const { setIsSummaryExpand, isSummaryExpanded:open } = useTaskContext();

  // Collapsed pill shows a plain one-line teaser: the first real bullet, not the
  // "## What this is" header (which react-markdown would render as a heading).
  const teaser = summaryTeaser(markdown);

  const toggle = ()=>setIsSummaryExpand(prev=>!prev)
  const handleClickOutside = ()=>setIsSummaryExpand(false)
  useClickOutside(null, handleClickOutside, 'task-summary-container');

  return (

    <div
      id="task-summary-container"
      className={`task-summary bg-taskDetal-container w-full relative
        ${open?"":""}
        `}>
      <div className={`${open?"":"overflow-hidden"} header group relative text-text-light-gray`} onClick={toggle}>
        {
          !open? 
          <div className='flex gap-1 justify-start max-w-[65%] items-center group'>
            <span className="font-medium headline line-clamp-1 text-dense w-fit">{teaser}</span>
            <ArrowDown open={false}/>
          </div>
          :
          <div className='flex gap-1 justify-start items-center'>
            <span className='font-medium text-dense'>Summary</span>
            <ArrowDown open={true}/>
          </div>
          
        }
      </div>
      
      {/* The panel bleeds out of the padded title column and re-applies the
          same padding, so its text lands on the title's left edge. The bleed
          must mirror `task-detail-horizontal-title-container` exactly: same
          container-query breakpoints, same values. */}
      {open && (
        <div className={`markdown pt-2 pb-[44px] z-10
          text-white-black absolute bg-taskDetal-container task-detail-horizontal-title-container
          top-[28px] left-0 right-0
          @xs:left-[-18px] @xs:right-[-18px]
          @sm:left-[-5.125rem] @sm:right-[-4rem]
          @xl:left-[-5.125rem] @xl:right-[-4rem]
          `}>
          <Markdown className={`max-w-[65%]`}>{markdown}</Markdown>
        </div>
      )}
    </div>
  );
}

export default TaskSummary;

// Moved to src/utils/summaryTeaser.ts so it can be unit-tested without
// this component's scss import; re-exported for existing importers.
export { summaryTeaser } from "@/utils/summaryTeaser";

const ArrowDown = (
  {
    open=false
  }:{
    open:boolean
  }
)=>{
  return (
    <span className={`relative  ${open?"":"scale-0 group-hover:scale-100"}  `}>
            <ChevronDown size={14} className={`text-content ${open?"rotate-180":""}`} strokeWidth={1.75}/>
            <Tooltip
            portal
            left={20}
            bottom={-6}
            text="Expand summary"
            keyCombination={["I"]}
            />
          </span>
  )
}
