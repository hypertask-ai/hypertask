import { useDescriptionAndCommentsContext } from '@/lib/contexts/TaskDetail/DescriptionProvider'
import UploadingCommentContainer from '.'

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
            totalAttachments={comment.totalAttachments}
            navigateToNextParams={comment.navigateToNextParams}
            taskId={comment.taskId}
            ownerId={comment.ownerId}
            projectId={comment.projectId}
            modelSource={comment.modelSource}
            modelOptionId={comment.modelOptionId}
            byokProviderFlags={comment.byokProviderFlags}
            taskTitle={comment.taskTitle}
            taskDescription={comment.taskDescription}
            />
    )}
    </>
  )
}

export default UploadingCommentsContainer
