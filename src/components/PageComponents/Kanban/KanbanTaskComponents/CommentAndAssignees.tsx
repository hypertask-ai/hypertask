import { INotification } from '@/models/model';
import React from 'react'
import { MessageCircle } from "lucide-react";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_8255_KANBAN_CLEANUP_FLAG } from "@/lib/flags/definitions/htpr-8255-kanban-cleanup";

interface ICommentAndAssignees {
  commentCount?:number;
  notifications:INotification[];
}

const CommentAndAssignees:React.FC<ICommentAndAssignees> = ({commentCount, notifications}) => {
  const cleanup = useFlag(HTPR_8255_KANBAN_CLEANUP_FLAG);
  const metaColor = cleanup ? 'text-[#cdd1d3]' : 'text-label-component';

  return (

      commentCount && commentCount > 0? (
        <div className='bg-inherit border-[0px]  h-labelComponent 
          text-emphasis
          border-border-labelComponent rounded-sm flex gap-1 items-center px-[4px] py-[1px]'>
          <MessageCircle size={14} className={metaColor} strokeWidth={1.75}/>
          <span className={`${metaColor} text-meta`}>
            {commentCount}
          </span>
        </div>
      ) : (
        <></>
      )

     
  )
}

export default CommentAndAssignees
