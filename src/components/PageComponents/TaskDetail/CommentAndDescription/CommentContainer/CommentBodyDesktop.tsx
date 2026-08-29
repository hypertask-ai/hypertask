import globalConstants from "@/lib/constants";
import { useCommentsContext } from "@/lib/contexts/CommentsContext";
import styles from '@/styles/tiptap.module.scss'

const CommentBodyDesktop  =(
    {
        children
    }:{
        children: React.ReactNode;
        
    }
)=>{

    const { 
        isStacked
      } = useCommentsContext();
   
    return (
        <div 

            className={`
            group 
            rounded-tl-none rounded-bl-none
            
            w-full grid items-center
            ${isStacked ? ` ${styles.stackedContainer}`:`comment-body bg-comment-description rounded-br rounded-tr ${styles.unstackedContainer}`} 
            ${styles.hellow}
            `}>
                {children}
                
        </div>
    )
}

export default CommentBodyDesktop 