import { useDescriptionAndCommentsContext } from '@/lib/contexts/TaskDetail/DescriptionProvider'
import UploadingCommentContainer from '.'

// index set: render only that queued comment (virtualized feed renders one row
// per item). index omitted: render all (non-virtualized fallback renders once).
const UploadingCommentsContainer = ({ index }: { index?: number }) => {
    const {uploadingComments}= useDescriptionAndCommentsContext()
    const toRender = index === undefined
      ? uploadingComments ?? []
      : uploadingComments?.[index] ? [uploadingComments[index]] : []

  return (
    <>
    {toRender.map((comment)=>
        <UploadingCommentContainer
            key={comment.id}
            id={comment.id}
            attachments={comment.attachments}
            content={comment.content}
            totalAttachments={comment.totalAttachments} // for the time being, but what we want here is the total length of image tags + attachments
            navigateToNextParams={comment.navigateToNextParams}
            taskId={comment.taskId}
            ownerId={comment.ownerId}
            />
    )}
    </>
  )
}

export default UploadingCommentsContainer
