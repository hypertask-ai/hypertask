
import ImageGallery from '@/components/Common/AttachmentsUpload/ImageGalleryView';
import useSaveContent from '@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent';
import { useDescriptionAndCommentsContext } from '@/lib/contexts/TaskDetail/DescriptionProvider';
import { modifiedHtml } from '@/models/model';
import React, { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast';

type UploadedFile = File & { source?: string };
interface UploadFileItem {
  id: number;
  file: UploadedFile;
}

interface IProps {
  id: number,
  content: string,
  attachments: UploadFileItem[],
  totalAttachments: number
}


const UploadingDescription: React.FC<IProps> = ({ id, content, attachments, totalAttachments }) => {
  console.log("🚀 ~ UploadingDescription ~ attachments:", attachments)
  const hasRun = useRef(false);
  const hasCompleted = useRef(false);
  const { uploadingDescription, setUploadingDescription } = useDescriptionAndCommentsContext();

  const [inlineImagesUploadedTotal, setInlineImagesUploadedTotal] = useState<number>(0);
  console.log("🚀 ~ inlineImagesUploadedTotal:", inlineImagesUploadedTotal)
  const [processedResult, setProcessedResult] = useState<modifiedHtml | null>(null);
  const [uploadedAttachments, setUploadedAttachments] = useState<UploadFileItem[]>([])
  const [progressPercentage, setProgressPercentage] = useState<number>(0);
  console.log("🚀 ~ uploadedAttachments:", uploadedAttachments)

  const [totalChecks, setTotalChecks] = useState({
    content: false,
    attachments: false
  });
  const { processHtml, handleSubmit } = useSaveContent();
  const complete = (saved: boolean) => {
    if (hasCompleted.current) return;
    hasCompleted.current = true;
    uploadingDescription?.onComplete?.(saved);
  };
  const UploadFlow = async () => {
    try {
      const content_ = await processHtml(content, setInlineImagesUploadedTotal)
      setProcessedResult(content_)
      setTotalChecks(prev => ({ ...prev, content: true }));
    } catch (error) {
      console.error("Could not process description content", error);
      setUploadingDescription(undefined);
      toast.error("Could not save description. Your changes are still here.");
      complete(false);
    }
  }


  const callbackAttachments = async (attachmentsReturned: UploadFileItem[]) => {
    console.log("🚀 ~ callbackAttachments ~ attachmentsReturned:", attachmentsReturned)
    setUploadedAttachments(attachmentsReturned)
    setTotalChecks(prev => ({ ...prev, attachments: true }));
  }

  const finalStep = async () => {
    try {
      const saved = await handleSubmit(
        content,
        processedResult,
        uploadedAttachments.map((attachment) => attachment.file),
      );
      complete(saved);
    } catch (error) {
      console.error("Could not finish description upload", error);
      setUploadingDescription(undefined);
      toast.error("Could not save description. Your changes are still here.");
      complete(false);
    }
  }


  useEffect(() => { if (totalChecks.content && totalChecks.attachments) void finalStep() }, [totalChecks])
  useEffect(() => {
    const totalAttachmentsUploaded = inlineImagesUploadedTotal + uploadedAttachments.length;
    const progressPerAttachment = 100 / totalAttachments;
    const totalProgress = progressPerAttachment * totalAttachmentsUploaded;

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
          onUploadFailed={() => {
            setUploadingDescription(undefined);
            complete(false);
          }}
        />
      </div>
    </>
  )
}

export default UploadingDescription
