import styles from '@/styles/tiptap.module.scss'

const CommentBodyDesktop  =(
    {
        children, isStacked, threadSpacing = false
    }:{
        children: React.ReactNode;
        isStacked: boolean;
        threadSpacing?: boolean;
        
    }
)=>{

   
    return (
        <div 

            className={`
            group 
            rounded-tl-none rounded-bl-none
            
            w-full grid items-center
            ${isStacked ? ` ${styles.stackedContainer}`:`comment-body bg-comment-description rounded-br rounded-tr ${styles.unstackedContainer}`} 
            ${styles.hellow} ${threadSpacing && !isStacked ? styles.threadCard : ""}
            `}>
                {children}
                
        </div>
    )
}

export default CommentBodyDesktop 