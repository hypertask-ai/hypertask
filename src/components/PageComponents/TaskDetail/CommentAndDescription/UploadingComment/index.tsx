import ImageGallery from '@/components/Common/AttachmentsUpload/ImageGalleryView';
import useSaveContent from '@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent';
import styles from '@/styles/tiptap.module.scss'
import React,{useState, useEffect, useRef, useMemo} from 'react'
import InnerHTMLComment from '../CommentContainer/InnerHTMLComment';
import useArchiveAndNavigate from '@/hooks/Task Detail/useArchiveAndNavigate';
import { NavigateToNextTaskParams } from '@/models/model';

interface IProps{
    id:number,
    content:string,
    attachments:File[],
    totalAttachments:number;
    navigateToNextParams: NavigateToNextTaskParams
    // Captured when the user hit send, so the comment lands on the task it was
    // written for even if the user has navigated away since (HTPR-3175).
    taskId?: number
    ownerId?: number
}
// 1: process html
// 2: setInlineImagesUploadedTotal pass this callback. 
// 3: when ALL attachments are uploaded, create the comment and use setComments to upload it. 

// Module-level because the virtualizer can remount the row mid-flight.
const startedUploads = new Set<number>();
const createdUploads = new Set<number>();

const UploadingCommentContainer:React.FC<IProps> = ({id,content, attachments,totalAttachments, navigateToNextParams, taskId, ownerId}) => {
    const hasRun = useRef(false);
    const hasCreated = useRef(false);

//   const [uploadedTotal, setUploadedTotal] = useState<number>(0);
  const [inlineImagesUploadedTotal, setInlineImagesUploadedTotal] = useState<number>(0);
  const [processedResult, setProcessedResult] = useState<string>("");
  const [uploadedAttachments, setUploadedAttachments] = useState<any[]>([]) 
  const [progressPercentage, setProgressPercentage] = useState<number>(0);
  const { navigateToNextTask, markAsDone } = useArchiveAndNavigate();

  const [totalChecks, setTotalChecks] = useState({
    content:false,
    attachments:false
  });
  const {processHtml,createComment, uploadAttachmentsComments } = useSaveContent();
  const UploadFlow =async()=>{
    const content_:any = await processHtml(content, setInlineImagesUploadedTotal)
    console.log("🚀 ~ UploadFlow ~ content_:", content_)
    setProcessedResult(content_)
    setTotalChecks(prev => ({ ...prev, content: true }));
  }

// RUN WHEN ALL IS DONE
// createComment(content_,content,"",uploadedAttachments,[], )


const callbackAttachments = async(attachmentsReturned:any[]) => {

  // get all the urls back
  console.log("🚀 ~ callbackAttachments ~ attachmentsReturned:", attachmentsReturned)
    // this is confirmation that attachments are uploaded.
    // setTotalChecks(prev=>prev+1)
    setUploadedAttachments(attachmentsReturned)
    setTotalChecks(prev => ({ ...prev, attachments: true }));
  }

    // run this use effect whenever the passed checks change
    const finalStep = async()=>{
      // ponytail: guard once — createComment removes this item only after its
      // async POST resolves, so any second totalChecks change in that window
      // (ImageGallery re-firing callbackAttachments) would post a duplicate
      // comment. One container = exactly one comment. (HTPR duplicate-comment)
      if (hasCreated.current || createdUploads.has(id)) return;
      hasCreated.current = true;
      createdUploads.add(id);
      await createComment(
          processedResult,
          content,
          "",
          uploadedAttachments.map((att:any)=>att.file),
          id,
          attachments,
          taskId,
          ownerId
        )
      setTimeout(() => {
        if(navigateToNextParams.markAsDone) markAsDone(navigateToNextParams.taskStatus === "Archive"? true:undefined)
        else navigateToNextTask(
            navigateToNextParams.archiveNotification, 
            navigateToNextParams.shouldNavigate,
            navigateToNextParams.remindMe,
            navigateToNextParams.force,
            navigateToNextParams.inboxFlow
          );
      }, 100); 

    } 
        


  useEffect(() => {
    if (hasRun.current || startedUploads.has(id)) return;
    startedUploads.add(id);
    UploadFlow();
    hasRun.current = true;
  }, [])

  useEffect(()=>{if (totalChecks.content && totalChecks.attachments) finalStep()},[totalChecks])
  useEffect(() => {
    // Calculate the total number of attachments that need to be uploaded
  
    const totalAttachmentsUploaded = inlineImagesUploadedTotal + uploadedAttachments.length;
    const progressPerAttachment = 100 / totalAttachments; // Calculate the progress per attachment
    const totalProgress = progressPerAttachment * totalAttachmentsUploaded; // Calculate the total progress
  
    // Update the progress percentage based on the total progress
    setProgressPercentage(totalProgress);
  }, [uploadedAttachments, inlineImagesUploadedTotal, totalAttachments]);
  
  return (
    <>
    <div 

      className={`
      group 
      rounded-tl-none rounded-bl-none mb-2
      gap-[2px] flex flex-col items-baseline
      w-full items-center
      ${false ? ` ${styles.stackedContainer}`:`bg-comment-description rounded-br rounded-tr ${styles.unstackedContainer}`} 
      ${styles.hellow}
      `}>
          <span className='text-meta text-white-black w-full'>Sending...</span>
          <InnerHTMLComment
            stackedStyle={ false?`${styles.stackedComment}`:`${styles.unstacked_grid_row2}`} 
            commentText={content} 
            id={`comment-${id}`}
            />
      <div className='attachment-upload-container bg-transparent '>

        <ImageGallery 
          files={attachments} 
          mode='others'
          images={[]} 
          handleRemove={null} 
          shouldUpload={true} 
          allowDelete={false}
          callbackAttachments={callbackAttachments}
          />
      </div>        
      </div>
    
    </>
  )
}

export default UploadingCommentContainer
