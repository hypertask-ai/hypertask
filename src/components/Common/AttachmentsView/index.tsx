import React, { useState, useEffect } from "react";
import "@/styles/AttachmentView.scss";
import { IAttachment, TCarousalItems } from "@/models/model";
import { Paperclip } from "lucide-react";

interface IProps {
  attachments: IAttachment[];
  active: boolean;
  setCarousalItems?: React.Dispatch<React.SetStateAction<TCarousalItems>>;
  compact?: boolean;
  // `compact` is about tile density, not side. The AI chat bubble is the only
  // surface that wants its tiles on the right; mobile comments read left like
  // their own text does, and like desktop comments already do (HTPR-5099).
  alignEnd?: boolean;
}

const AttachmentView = (props: IProps) => {
  const compact = Boolean(props.compact);
  const [attachments, setAttachments] = useState<IAttachment[]>(
    props.attachments ?? []
  );

  useEffect(() => {
    setAttachments(props.attachments);
  }, [props.attachments]);

  const showModalAttachment = (attachmentIndex: number) => {
    props.setCarousalItems &&
      props.setCarousalItems({
        attachments: attachments,
        currentIndex: attachmentIndex,
      });
    document.getElementById("carousel-container")?.focus();
  };

  return (
    <>
      {attachments?.length > 0 && (
        <div
          className={`main-attachment-container mx-0 flex flex-wrap ${
            compact
              ? `bg-transparent gap-2 mb-2 ${props.alignEnd ? "justify-end" : "justify-start"}`
              : "bg-comment-description gap-2"
          }`}
        >
          {attachments?.map((attachment, index) => {
            const isImage = attachment?.fileType?.startsWith("image/");
            if (compact) {
              return (
                <div
                  className="relative z-0 h-fit w-[60px] max-w-[60px] cursor-pointer items-end"
                  key={index}
                >
                  <div
                    onClick={() => showModalAttachment(index)}
                    className="attachment-tile flex min-h-0 min-w-0 w-full flex-col items-center justify-start rounded-md bg-[#27292D] p-1 text-white"
                  >
                    <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-md bg-secondary">
                      {isImage ? (
                        <img
                          className="h-full w-full rounded-md object-contain"
                          src={attachment.fileSource}
                          alt={attachment.fileName}
                        />
                      ) : (
                        <Paperclip size={18} className="text-display text-white/90" strokeWidth={1.75} />
                      )}
                    </div>
                    <span
                      className="mt-1 w-full min-w-0 max-w-full shrink-0 break-words px-0.5 py-0 text-center text-micro font-normal leading-tight [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                      title={attachment.fileName}
                    >
                      {attachment.fileName}
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <div
                className="cursor-pointer  mb-2 relative z-0 w-max-[60px]  h-max-[60px] h-fit items-end"
                key={index}
              >
                <div
                  onClick={() => showModalAttachment(index)}
                  className="attachment-tile flex h-full w-full flex-col items-center justify-end rounded-md bg-[#27292D] p-2 text-white-black"
                >
                  <div
                    className={`grid bg-secondary ${isImage ? "p-1" : "p-4"}`}
                  >
                    {isImage ? (
                      <img
                        style={{ height: "68px", width: "68px" }}
                        className="object-cover rounded-md"
                        src={attachment.fileSource}
                        alt={attachment.fileName}
                      />
                    ) : (
                      <Paperclip size={18} className="text-heading text-center rounded-md" strokeWidth={1.75} />
                    )}
                  </div>
                  <span className="attachment-tile-name line-clamp-1 h-[30px] w-[60px] overflow-hidden py-2 text-center text-dense text-white">
                    {attachment.fileName}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

export default AttachmentView;
