import { INotification } from '@/models/model';
import React from 'react'
import { MessageCircle } from "lucide-react";

interface ICommentAndAssignees {
  commentCount?:number;
  notifications:INotification[];
  compact?:boolean;
}

const CommentAndAssignees:React.FC<ICommentAndAssignees> = ({commentCount, notifications, compact = false}) => {

  return (

      commentCount && commentCount > 0? (
        <div className='bg-inherit border-[0px]  h-labelComponent 
          text-emphasis
          border-border-labelComponent rounded-sm flex gap-1 items-center px-[4px] py-[1px]'>
          <MessageCircle size={compact ? 12 : 14} className='text-label-component' strokeWidth={1.75}/>
          <span className={compact ? 'text-label-component text-micro leading-4' : 'text-label-component text-meta'}>
            {commentCount}
          </span>
        </div>
      ) : (
        <></>
      )

     
  )
}

export default CommentAndAssignees
