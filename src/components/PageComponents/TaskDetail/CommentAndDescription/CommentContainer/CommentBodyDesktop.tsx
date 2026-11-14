import { useContext } from "react";
import { CommentsContext } from "@/lib/contexts/CommentsContext";
import styles from '@/styles/tiptap.module.scss'

const CommentBodyDesktop  =(
    {
        children,
        isStacked: isStackedProp,
    }:{
        children: React.ReactNode;
        isStacked?: boolean;
    }
)=>{
    const comment = useContext(CommentsContext);
    const isStacked = isStackedProp ?? Boolean(comment?.isStacked);

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
