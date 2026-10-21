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
  const { setIsSummaryExpand, isSummaryExpanded:open } = useTaskContext();

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
