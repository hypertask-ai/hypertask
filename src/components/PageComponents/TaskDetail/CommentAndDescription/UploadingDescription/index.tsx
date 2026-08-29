
import ImageGallery from '@/components/Common/AttachmentsUpload/ImageGalleryView';
import useSaveContent from '@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent';
import React, { useState, useEffect, useRef } from 'react'


interface IProps {
  id: number,
  content: string,
  attachments: File[],
  totalAttachments: number
}
// 1: process html
// 2: setInlineImagesUploadedTotal pass this callback. 
// 3: when ALL attachments are uploaded, create the comment and use setComments to upload it. 


const UploadingDescription: React.FC<IProps> = ({ id, content, attachments, totalAttachments }) => {
  console.log("🚀 ~ UploadingDescription ~ attachments:", attachments)
  const hasRun = useRef(false);

  const [inlineImagesUploadedTotal, setInlineImagesUploadedTotal] = useState<number>(0);
  console.log("🚀 ~ inlineImagesUploadedTotal:", inlineImagesUploadedTotal)
  const [processedResult, setProcessedResult] = useState<string>("");
  const [uploadedAttachments, setUploadedAttachments] = useState<any[]>([])
  const [progressPercentage, setProgressPercentage] = useState<number>(0);
  console.log("🚀 ~ uploadedAttachments:", uploadedAttachments)

  const [totalChecks, setTotalChecks] = useState({
    content: false,
    attachments: false
  });
  const { processHtml, handleSubmit } = useSaveContent();
  const UploadFlow = async () => {
    const content_: any = await processHtml(content, setInlineImagesUploadedTotal)
    setProcessedResult(content_)
    setTotalChecks(prev => ({ ...prev, content: true }));
  }

  // RUN WHEN ALL IS DONE

  const callbackAttachments = async (attachmentsReturned: any[]) => {

    // get all the urls back
    console.log("🚀 ~ callbackAttachments ~ attachmentsReturned:", attachmentsReturned)
    // this is confirmation that attachments are uploaded.
    // setTotalChecks(prev=>prev+1)
    setUploadedAttachments(attachmentsReturned)
    setTotalChecks(prev => ({ ...prev, attachments: true }));
  }

  // run this use effect whenever the passed checks change
  const finalStep = () => handleSubmit(content, processedResult, uploadedAttachments?.map((att: any) => att.file))


  useEffect(() => { if (totalChecks.content && totalChecks.attachments) finalStep() }, [totalChecks])
  useEffect(() => {
    // Calculate the total number of attachments that need to be uploaded

    const totalAttachmentsUploaded = inlineImagesUploadedTotal + uploadedAttachments.length;
    const progressPerAttachment = 100 / totalAttachments; // Calculate the progress per attachment
    const totalProgress = progressPerAttachment * totalAttachmentsUploaded; // Calculate the total progress

    // Update the progress percentage based on the total progress
    setProgressPercentage(totalProgress);
  }, [uploadedAttachments, inlineImagesUploadedTotal, totalAttachments]);

  useEffect(() => {
    if (!hasRun.current) {
      UploadFlow();
      hasRun.current = true;
    }
  }, [])

  return (
    <>

      <div

        className={`
      attachment-upload-container 
      my-2
      `}>

        <ImageGallery
          files={attachments}
          images={[]}
          handleRemove={null}
          mode='others'
          shouldUpload={true}
          allowDelete={false}
          callbackAttachments={callbackAttachments}
        />
      </div>
      {/* <span className='w-full text-content font-bold text-icon-dark-gray'>Updating...</span> */}
    </>
  )
}

export default UploadingDescription
