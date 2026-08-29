import KBDElement from "@/components/Common/kbd"
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider"
import { IUser } from "@/models/model"
import { useEffect } from "react"

const QuoteButton = ({selection, creator}:{selection:string, creator: IUser})=>{
    const {InsertContentInCommentInput } = useDescriptionAndCommentsContext()

    const handleKeyDown = (e:any)=>{
      if (e.key==="Enter")InsertContentInCommentInput(selection, creator)
    }
    useEffect(() => {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);})
  return (
    <div  
      className="text-content text-white-black-inverted
      border-light-black-border-1 border-[1px]
      bg-labelComponent 
      font-bold items-center p-2 cursor-pointer rounded-sm flex gap-2" 
      onClick={(e)=>{e.stopPropagation()
      InsertContentInCommentInput(selection, creator)}}>
      <span className="text-black font-bold">
        Quote
      </span>
      <KBDElement content="ENTER"/> 
    </div>
  )
}

export default QuoteButton
