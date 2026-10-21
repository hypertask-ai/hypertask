import ImageGallery from '@/components/Common/AttachmentsUpload/ImageGalleryView';
import useSaveContent from '@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent';
import styles from '@/styles/tiptap.module.scss'
import React,{useState, useEffect, useRef, useMemo} from 'react'
import InnerHTMLComment from '../CommentContainer/InnerHTMLComment';
import useArchiveAndNavigate from '@/hooks/Task Detail/useArchiveAndNavigate';
import { ITeamByokApiKey, NavigateToNextTaskParams } from '@/models/model';

interface IProps{
    id:number,
    content:string,
    attachments:File[],
    totalAttachments:number;
    navigateToNextParams: NavigateToNextTaskParams
    taskId?: number
    ownerId?: number
    projectId?: number
    modelSource?: string
    modelOptionId?: string
    byokProviderFlags?: ITeamByokApiKey[]
    taskTitle?: string
    taskDescription?: string
}

const startedUploads = new Set<number>();
const createdUploads = new Set<number>();

const UploadingCommentContainer:React.FC<IProps> = ({id,content, attachments,totalAttachments, navigateToNextParams, taskId, ownerId, projectId, modelSource, modelOptionId, byokProviderFlags, taskTitle, taskDescription}) => {
    const hasRun = useRef(false);
    const hasCreated = useRef(false);

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

const callbackAttachments = async(attachmentsReturned:any[]) => {
  console.log("🚀 ~ callbackAttachments ~ attachmentsReturned:", attachmentsReturned)
    setUploadedAttachments(attachmentsReturned)
    setTotalChecks(prev => ({ ...prev, attachments: true }));
  }

    const finalStep = async()=>{
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
          ownerId,
          projectId,
          modelSource,
          modelOptionId,
          byokProviderFlags,
          taskTitle,
          taskDescription,
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
    const totalAttachmentsUploaded = inlineImagesUploadedTotal + uploadedAttachments.length;
    const progressPerAttachment = 100 / totalAttachments;
    const totalProgress = progressPerAttachment * totalAttachmentsUploaded;
  
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
