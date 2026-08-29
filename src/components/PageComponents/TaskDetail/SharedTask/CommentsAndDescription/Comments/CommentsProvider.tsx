import { useContext } from "react";
import { IComment } from "@/models/model";
import { CommentsProvider } from "@/lib/contexts/CommentsContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useDescriptionAndCommentsContext } from "@/lib/contexts/TaskDetail/DescriptionProvider";
import SharedCommentsContainer from "./CommentContainer";

interface CommentsProviderProps {}
const SharedCommentsProvider: React.FC<CommentsProviderProps> = ({
  ...props
}) => {
  const { comments, stacked } = useDescriptionAndCommentsContext();
  const _mbl = useContext(MobileViewContext);

  return (
    <>
      {comments &&
        comments.map((comment: IComment, i: number) => (
          <CommentsProvider
            key={`comment-provider-${comment.id}`}
            comment={comment}
            i={i}
            isStacked={stacked[i]}
          >
            <SharedCommentsContainer />
          </CommentsProvider>
        ))}
    </>
  );
};

export default SharedCommentsProvider;
