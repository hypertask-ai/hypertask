import { memo, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import styles from "@/styles/tiptap.module.scss";
import { useRecoilState } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { useContext } from "react";


import { IAttachment } from "@/models/model";
import { cn } from "@/utils/undoActions/helperFuncs";
import { linkifyHtml } from "@/utils/helperFunctions/linkifyHtml";
import { useRouter } from "next/navigation";
import { HighlightMenu } from "../ContextMenu";

import QuoteButton from "../ContextMenu/QuoteButton";
import { useGifPlayback } from "@/hooks/General/useGifPlayback";
import CommentTldr from "./CommentTldr";
import { normalizeRichHtmlForRender } from "@/utils/helperFunctions/normalizeRichHtmlForRender";
import { normalizeImageSourcesInHtml } from "@/utils/helperFunctions/normalizeImageSource";

export const generateAttachmentFromImgEl = (
  img: HTMLImageElement,
  idx: number
) => {
  return {
    id: idx + 1,
    createdAt: -1,
    fileType: "image/png",
    taskId: 1,
    fileSource: img.src,
    fileName: "Image.png",
  };
};
// eslint-disable-next-line react/display-name
const InnerHTMLComment = memo(
  ({
    commentText,
    id,
    stackedStyle,
    attachmentsFromParent,
    classNameProp,
    commentCreator,
    isStacked,
    summary,
    setCarousalItems,
    allowQuote = true,
  }: any) => {
    const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);
    const mbl = useContext(MobileViewContext);
    const router = useRouter();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [attachments, setAttachments] = useState<IAttachment[]>([]);
    const [currIdx, setcurrentIdx] = useState(0);

    const divRef = useRef<HTMLDivElement>(null);
    const gifContainerRef = useRef<HTMLDivElement>(null);
    // const { } = useDescriptionAndCommentsContext()

    // HTPR-3779: turn bare URLs (e.g. CLI-posted comments) into clickable links.
    const renderedHtml = useMemo(
      () =>
        linkifyHtml(
          normalizeImageSourcesInHtml(
            normalizeRichHtmlForRender(commentText ?? ""),
          ),
        ),
      [commentText],
    );
    const { control: gifPlaybackControl } = useGifPlayback(
      gifContainerRef,
      renderedHtml,
    );

    // ----------------------- close gallery modal
    const toggleModal = () => {
      setIsModalOpen(!isModalOpen);
    };
    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as any;
      //
      if (target && target.tagName === "IMG") {
        const images = Array.from(
          divRef.current?.querySelectorAll("img") || []
        );
        const clickedImageIndex = images.findIndex((img) => img === target);

        setcurrentIdx(clickedImageIndex);
        // toggleModal()
        // Set the attachments with the clicked image's details
        const inlineImages = images.map((img, idx) =>
          generateAttachmentFromImgEl(img, idx)
        );
        setAttachments([...inlineImages, ...(attachmentsFromParent ?? [])]);
        setCarousalItems && setCarousalItems({
          attachments: [...inlineImages, ...(attachmentsFromParent ?? [])],
          currentIndex: clickedImageIndex,
        });
      } else if (target && target.tagName === "A") {
        var href = target.getAttribute("href");

        // Check if the href contains the domain 'app.hypertask'
        if (
          (href && href.includes("app.hypertask")) ||
          href.startsWith("/detail")
        ) {
          event.preventDefault();
          // Call your custom function here
          router.push(href);
        } else target.setAttribute("target", "_blank");
      }
    };

    return (
      <>
        {/* stackedStyle carries grid-row/column placement, so it must sit on
            this wrapper — the card grid's direct child — not the inner div. */}
        <div ref={gifContainerRef} className={cn("relative", !mbl && stackedStyle)}>
          {!isStacked && summary && <CommentTldr summary={summary} />}
          <div
            ref={divRef}
            onClick={handleClick}
            className={cn(
              classNameProp,
              mbl
                ? ` ${commentCreator?.id === currentUser?.id ? "" : ""}
          text-white-black
          ${isStacked ? "line-clamp-3" : ""}
          ${styles.editorContainer} ${styles.customLineBreak}`
                : `
             ${styles.ProseMirror} w-full text-white-black
              max-w-[85cqw] @lg:max-w-[650px] break-words
             ${styles.editorContainer} ${styles.customLineBreak}`
            )}
            id={id}
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          ></div>
          {gifPlaybackControl}
        </div>
        {allowQuote && (
          <HighlightMenu
            target={divRef}
            allowedPlacements={["top", "bottom"]}
            menu={({ selectedText = "", selectedHtml }) => (
              <>
                <QuoteButton selection={selectedHtml ?? ""} creator={commentCreator}/>
              </>
            )}
          />
        )}
        {/* {
          isModalOpen && 
          <AttachmentCarousel 
            closeCallback={() => setIsModalOpen(false)}
            attachments={attachments} 
            currentIndex={currIdx} />
        } */}
      </>
    );
  }
);

export default InnerHTMLComment;
