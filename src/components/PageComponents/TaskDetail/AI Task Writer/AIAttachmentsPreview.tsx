import { useState } from "react";
import { X, FileText } from "lucide-react";


import { cn } from "@/utils/undoActions/helperFuncs";
import dynamic from 'next/dynamic';
import { IAttachment } from "@/models/model";

const AttachmentCarousel = dynamic(() => import("@/components/Common/AttachmentsView/AttachmentsCarousel"), { ssr: false });

interface IAIAttachment {
  id: string;
  file: File;
  preview: string;
  type: 'image' | 'pdf' | 'docx';
}

interface AITaskWriterAttachmentsProps {
  attachments: IAIAttachment[];
  removeAttachment?: (id: string) => void;
  className?: string;
  isInHistory?: boolean;
}

const AIAttachmentsPreview: React.FC<AITaskWriterAttachmentsProps> = ({
  attachments,
  removeAttachment,
  className,
  isInHistory = false,
}) => {
  console.log("🚀 ~ AITaskWriterAttachments ~ attachments:", attachments.flatMap(x=>x.preview))
  const [isCarouselOpen, setIsCarouselOpen] = useState(false);
  const [currentCarouselIndex, setCurrentCarouselIndex] = useState(0);

  if (attachments.length === 0) return null;

  // Convert AI attachments to IAttachment format for carousel
  const convertToCarouselFormat = (aiAttachments: IAIAttachment[]): IAttachment[] => {
    return aiAttachments.map((attachment, index) => ({
      id: parseInt(attachment.id) || index,
      createdAt: new Date(),
      fileType: attachment.file.type,
      fileSource: attachment.preview,
      fileName: attachment.file.name,
      fileSize: attachment.file.size.toString(),
    }));
  };

  const handleAttachmentClick = (index: number) => {
    setCurrentCarouselIndex(index);
    setIsCarouselOpen(true);
  };

  const handleCarouselClose = () => {
    setIsCarouselOpen(false);
  };

  const renderThumbnail = (attachment: IAIAttachment, index: number) => {
    switch (attachment.type) {
      case 'image':
        return (
          <div 
            className="p-1 grid bg-secondary h-[68px] w-[68px] cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => handleAttachmentClick(index)}
          >
            <img
              src={attachment.preview}
              alt={attachment.file.name}
              className="h-full w-full object-cover"
            />
          </div>
        );
      case 'pdf':
        return (
          <div 
            className="p-4 grid bg-secondary h-[68px] w-[68px] cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => handleAttachmentClick(index)}
          >
            <FileText size={18} className="text-heading text-center text-red-500 self-center justify-self-center"  strokeWidth={1.75}/>
          </div>
        );
      case 'docx':
        return (
          <div 
            className="p-4 grid bg-secondary h-[68px] w-[68px] cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => handleAttachmentClick(index)}
          >
            <FileText size={18} className="text-heading text-center text-blue-500 self-center justify-self-center"  strokeWidth={1.75}/>
          </div>
        );
      default:
        return null;
    }
  };

  const carouselAttachments = convertToCarouselFormat(attachments);

  return (
    <>
      <div className={cn("flex flex-wrap gap-2 ", className)}>
        {attachments.map((attachment, index) => (
          <div
            key={attachment.id}
            className="cursor-pointer mb-2 relative z-0 w-max-[60px] h-max-[60px] h-fit items-end"
          >
            <div className='ai-task-writer-attachment items-center w-full p-2 h-full flex flex-col rounded-md bg-[#27292D] text-white-black justify-end relative'>
              
              {/* Remove button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeAttachment?.(attachment.id);
                }}
                className={
                  cn(isInHistory && "hidden",
                    "ai-task-writer-attachment-remove absolute !border-thin !border-white/40 -top-1 -right-1 w-5 h-5 bg-[#27292D] hover:bg-gray-700 text-white rounded flex items-center justify-center shadow-md transition-colors duration-200 z-10", isInHistory && "hidden")}
                title={`Remove ${attachment.file.name}`}
              >
                <X size={14} className="ai-task-writer-attachment-remove-icon text-white"  strokeWidth={1.75}/>
              </button>

              {/* Thumbnail */}
              {renderThumbnail(attachment, index)}
              
              {/* File name */}
              <span className="ai-task-writer-attachment-name py-2 text-center text-white text-dense overflow-hidden h-[30px] w-[60px] line-clamp-1">
                {attachment.file.name}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Carousel */}
      {isCarouselOpen && (
        <AttachmentCarousel
          attachments={carouselAttachments}
          currentIndex={currentCarouselIndex}
          closeCallback={handleCarouselClose}
        />
      )}
    </>
  );
};

export default AIAttachmentsPreview;
