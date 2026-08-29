import { useContext} from "react";

import { IAttachment, IComment, IDraft, StackedType } from "@/models/model";
import { CommentsProvider } from "../CommentsContext";
import CommentsContainer from "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentsContainer";
import { MobileViewContext } from "../mobileContext";
import { useDescriptionAndCommentsContext } from "./DescriptionProvider";

import NewCommentComponent from "@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent";
import UploadingCommentsContainer from "@/components/PageComponents/TaskDetail/CommentAndDescription/UploadingComment/UploadingCommentContainer";



interface CommentsProviderProps {
}
  const AllCommentsProvider: React.FC<CommentsProviderProps> = ({
    ...props
  }) => {
    const {comments, stacked} = useDescriptionAndCommentsContext()
    const _mbl = useContext(MobileViewContext);


    return (
        <>
        {comments&&comments.map((comment:IComment, i:number) => (
                      // eslint-disable-next-line react/jsx-key
                      <CommentsProvider
                        key={`comment-provider-${comment.id}`} 
                        comment={comment} 
                        i={i}                
                        isStacked={stacked[i]}        
                        >
                            <CommentsContainer/>
                        </CommentsProvider>
                    ))
        }               
                  <UploadingCommentsContainer/>
                      
              {!_mbl && <NewCommentComponent/>}  
        </>        

    )
  }






  export default AllCommentsProvider