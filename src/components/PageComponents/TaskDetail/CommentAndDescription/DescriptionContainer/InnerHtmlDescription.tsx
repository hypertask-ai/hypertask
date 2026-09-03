/* eslint-disable react/display-name */
import { memo,  useRef, useState, useContext, useMemo } from "react";
import dynamic from "next/dynamic";
import styles from '@/styles/tiptap.module.scss'
const AttachmentCarousel = dynamic(()=>import("@/components/Common/AttachmentsView/AttachmentsCarousel"),{ssr:false})
import { IAttachment, IUser, TCarousalItems } from "@/models/model";
import { useRouter, useSearchParams } from "next/navigation";
import { generateAttachmentFromImgEl } from "../CommentContainer/InnerHTMLComment";
import { HighlightMenu } from "../ContextMenu";
import QuoteButton from "../ContextMenu/QuoteButton";
// import { useDeviceContext } from "@/lib/contexts/deviceContext";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { cn } from "@/utils/undoActions/helperFuncs";
import { useGifPlayback } from "@/hooks/General/useGifPlayback";
import { normalizeRichHtmlForRender } from "@/utils/helperFunctions/normalizeRichHtmlForRender";
import { normalizeImageSourcesInHtml } from "@/utils/helperFunctions/normalizeImageSource";
import {
  isInternalTaskDetailHref,
  preserveInboxFlowOnTaskHref,
  shouldFollowLinkNatively,
} from "@/lib/taskDetailInboxFlow";

interface IInnerHTMLDescription{
    descriptionText?:string,
    id:string,
    attachmentsFromProps:IAttachment[]
    allowQuote?:boolean;
    className?: string;
    setCarousalItems?: React.Dispatch<React.SetStateAction<TCarousalItems>>
    taskCreator?: IUser
    }
    const mobileDescriptionPlaceHolder = `<div class='text-[#AEB4BC]'><h2 class="text-subheading font-bold">Add Description</h2><p>Tip: Double tap to edit</p></div>`
    const desktopDescriptionPlaceHolder = `<div class='text-[#AEB4BC]'><h2>Add Description</h2><p>Tip: Hit ENTER to edit mode or CTRL+D to jump here</p></div>`
    
    // Corrected the placement of the closing parenthesis for the memo function call
const InnerHTMLDescription = memo(({  descriptionText, id,attachmentsFromProps, allowQuote, className, setCarousalItems, taskCreator }:IInnerHTMLDescription) => {
    const emptyDescriptions = ["<html><head></head><body><p></p></body></html>", "<p></p>", "", "<html><head></head><body></body></html>"]
    // const isApple = useDeviceContext()
    const _mbl = useContext(MobileViewContext);
    const currentDescriptionPlaceHolder = useMemo(()=>{
        if (_mbl){
            return mobileDescriptionPlaceHolder
        }
        else return desktopDescriptionPlaceHolder
    },[_mbl])
    const normalizedDescription = useMemo(
      () => normalizeImageSourcesInHtml(
        normalizeRichHtmlForRender(descriptionText ?? ""),
      ),
      [descriptionText],
    );
    const textToShow = (normalizedDescription.length===0 || emptyDescriptions.includes(normalizedDescription))?currentDescriptionPlaceHolder:normalizedDescription
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [attachments, setAttachments] = useState<IAttachment[]>([]);
    const [currIdx, setcurrentIdx] = useState(0);
    
    const router = useRouter();
    const inboxFlow = useSearchParams()?.get("inboxFlow");

    const divRef = useRef<HTMLDivElement>(null);
    const gifContainerRef = useRef<HTMLDivElement>(null);
    const { control: gifPlaybackControl } = useGifPlayback(
        gifContainerRef,
        textToShow,
    );

    // ----------------------- close gallery modal
    const toggleModal = () => {
      setIsModalOpen(!isModalOpen);
    };

    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as any;
        if (target && target.tagName === 'IMG') {
            const images = Array.from(divRef.current?.querySelectorAll('img') || []);
            const clickedImageIndex = images.findIndex(img => img === target);

            setcurrentIdx(clickedImageIndex)
            // toggleModal()
            // Set the attachments with the clicked image's details
            const inlineImages = images.map((img,idx)=>(generateAttachmentFromImgEl(img,idx))) 
            setAttachments([...inlineImages,...attachmentsFromProps??[]]);
            setCarousalItems && setCarousalItems({
                attachments: [...inlineImages,...attachmentsFromProps??[]],
                currentIndex: clickedImageIndex,
              })
        }
        else if (target && target.tagName === 'A') {
      
            var href = target.getAttribute('href');
            
            if (href && isInternalTaskDetailHref(href)) {
                if (shouldFollowLinkNatively(event)) return;
                event.preventDefault()
                // Call your custom function here
                router.push(preserveInboxFlowOnTaskHref(href, inboxFlow))
                
            }
            else target.setAttribute('target', '_blank');
          };
    };

    return (
        <>
        {/* ============ main container ============== */}
            <div className={`flex flex-col ${styles.hellow}`}>
                {/* ============== description info container============ */}
                
                {/* ============== description text container =========== */}
                <div ref={gifContainerRef} className="relative">
                    <div
                    ref={divRef}
                    onClick={handleClick}
                    className={ cn(`
                        my-[8px]
                        text-white-black
                        min-h-[106px]
                        @sm:text-emphasis @xs:text-content
                        ${styles.ProseMirror}
                        max-w-[85cqw] @lg:max-w-[650px] break-words
                        ${styles.editorContainer} ${styles.customLineBreak}`, className)}
                      id={id}

                      dangerouslySetInnerHTML={{__html:textToShow??""}}>
                    </div>
                    {gifPlaybackControl}
                </div>
            </div>
           {allowQuote && allowQuote === true && taskCreator && <HighlightMenu
                target={divRef}
                allowedPlacements={["top", "bottom"]}
                menu={({ selectedText = "", selectedHtml}) => (
                <>
                    <QuoteButton selection={selectedHtml??""} creator={taskCreator}/>
                </>
                )}
            />}
            {
                isModalOpen && 
                <AttachmentCarousel 
                    closeCallback={() => setIsModalOpen(false)}
                    attachments={attachments} 
                    currentIndex={currIdx} />
            }

        </>
    )
});

export default InnerHTMLDescription;
