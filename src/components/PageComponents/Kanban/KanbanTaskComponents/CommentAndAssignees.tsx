// import { TaskInInboxCircle } from '@/lib/IconsLocal';
import { INotification } from '@/models/model';
// import Image from 'next/image';
import React from 'react'
import { MessageCircle } from "lucide-react";

interface ICommentAndAssignees {
  commentCount?:number;
  notifications:INotification[];
}

const CommentAndAssignees:React.FC<ICommentAndAssignees> = ({commentCount, notifications}) => {

  return (

      commentCount && commentCount > 0? (
        <div className='bg-inherit border-[0px]  h-labelComponent 
          text-emphasis
          border-border-labelComponent rounded-sm flex gap-1 items-center px-[4px] py-[1px]'>
          <MessageCircle size={14} className='text-label-component' strokeWidth={1.75}/>
          <span className='text-label-component text-meta'>
            {commentCount}
          </span>
        </div>
      ) : (
        <></>
      )

     
  )
}

export default CommentAndAssignees
