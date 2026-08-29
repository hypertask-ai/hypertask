import { useContext} from "react";

import { IAttachment, IComment, IDraft, StackedType } from "@/models/model";

import CommentsContainer from "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer";

import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import { CommentsProvider } from "@/lib/contexts/CommentsContext";
import NewCommentComponent from "./NewCommentComponent";



interface CommentsProviderProps {
}
  const AllCommentsComponent: React.FC<CommentsProviderProps> = ({
    ...props
  }) => {
    const {comments, stacked} = useDescriptionAndCommentsContext()
    const _mbl = useContext(MobileViewContext);


    return (
        <>
        {comments&&comments.map((comment:IComment, i:number) => (
                      // eslint-disable-next-line react/jsx-key
                      <CommentsProvider 
                        comment={comment} 
                        i={i}                
                        isStacked={stacked[i]}        
                        >
                            <CommentsContainer/>
                        </CommentsProvider>
                    ))
        }               
                      
              {!_mbl && <NewCommentComponent/>}  
        </>        

    )
  }


export default  AllCommentsComponent;