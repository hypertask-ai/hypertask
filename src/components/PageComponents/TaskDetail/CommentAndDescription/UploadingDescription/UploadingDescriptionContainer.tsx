import { logger as htLogger } from "#logger";
import { useDescriptionAndCommentsContext } from '@/lib/contexts/TaskDetail/DescriptionProvider'
import React from 'react'
import UploadingDescription from '.'

const UploadingDescriptionContainer = () => {
    const {uploadingDescription}= useDescriptionAndCommentsContext()
    htLogger.info("🚀 ~ UploadingDescriptionContainer ~ uploadingDescription:", uploadingDescription)

  return (
    uploadingDescription ?
    <UploadingDescription
        id={1}
        content={uploadingDescription.content}
        attachments={uploadingDescription.descriptionAttachments}
        totalAttachments={uploadingDescription.totalAttachments}
        
    />
    :
    <></>
  )
}

export default UploadingDescriptionContainer