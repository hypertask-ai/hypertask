import { IAttachment } from "@/models/model";
import React, { useState, useEffect, useContext } from "react";
import "@/styles/AttachmentView.scss";
import DocViewer, { DocViewerRenderers } from "react-doc-viewer";
import Lightbox from "yet-another-react-lightbox";
import type { Slide } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import {
  Zoom,
  Download,
  Fullscreen,
  Thumbnails,
} from "yet-another-react-lightbox/plugins";
import "yet-another-react-lightbox/plugins/thumbnails.css";

import { MobileViewContext } from "@/lib/contexts/mobileContext";

interface AttachmentCarouselProps {
  attachments: IAttachment[];
  currentIndex: number;
  closeCallback: () => void;
}

const AttachmentCarousel: React.FC<AttachmentCarouselProps> = ({
  attachments,
  currentIndex,
  closeCallback,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [index, setIndex] = useState(currentIndex);
  const isMbl = useContext(MobileViewContext);

  useEffect(() => {
    setIndex(currentIndex);
  }, [currentIndex]);

  const handleDownload = async (fileSource: string, fileName: string) => {
    try {
      const response = await fetch(
        `/api/tasks/downloadAttachment?fileSource=${fileSource}&fileName=${fileName}`
      );
      const data = await response.json();

      if (!response.ok) {
        console.error("Error fetching download URL");
        return;
      }
      // Create an anchor tag with the download URL
      const anchor = document.createElement("a");
      anchor.href = data.downloadUrl;
      anchor.download = fileName;
      anchor.click();
    } catch (error) {
      console.error("Error downloading file:", error);
    }
  };

  const filesToCheck = ["xlsx", "docx", "doc", "pptx", "ppt"];

  // Transform attachments to lightbox slides format
  const slides: Slide[] = attachments.map((attachment) => {
    const attachmentUpdated = attachment.fileSource;

    if (attachment.fileType.startsWith("image/")) {
      return {
        src: attachmentUpdated,
        alt: attachment.fileName,
        width: 1200,
        height: 800,
      };
    } else if (attachment.fileType.startsWith("video/")) {
      return {
        type: "video" as const, // Explicitly mark as video type
        sources: [
          {
            src: attachmentUpdated,
            type: attachment.fileType,
          },
        ],
        // You might want to remove width/height here if you control with CSS
        // width: 1200,
        // height: 800,
        // controls: true, // Not a slide prop, handled in custom render
        // Add additional data if needed for custom rendering
        fileName: attachment.fileName, // Keep filename for the custom renderer if needed
      };
    } else {
      // For documents and other file types, we'll create a custom slide
      return {
        src: attachmentUpdated, // Keep src for consistent access, though not directly used for non-image/video by YARL
        title: attachment.fileName,
        alt: attachment.fileName,
        // Store additional data for custom rendering
        fileType: attachment.fileType,
        fileName: attachment.fileName,
        fileSource: attachment.fileSource,
      };
    }
  });

  // Custom render function for all content types
  const renderSlide = ({ slide, rect }: { slide: Slide; rect: any }) => {
    // --- Handle Video Slides ---
    if (slide.type === "video" && slide.sources) {
      // Find the original attachment for additional data if needed
      const originalAttachment = attachments.find(
        (att) => att.fileName === (slide as any).fileName
      );

      return (
        <div className="flex items-center justify-center h-full w-full">
          <video
            controls // Show video controls
            autoPlay={false} // Auto-play is generally disruptive, set to false
            preload="auto" // Preload metadata for faster start
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
            // You can also use YARL's rect.width/height if you want to size dynamically
            // width={rect.width}
            // height={rect.height}
          >
            {slide.sources.map((source, idx) => (
              <source key={idx} src={source.src} type={source.type} />
            ))}
            Your browser does not support the video tag.
          </video>
        </div>
      );
    }
    // --- Handle Document Slides (DocViewer) ---
    else if (
      (slide as any).fileType &&
      filesToCheck.some((x) => (slide as any).fileName.endsWith(x))
    ) {
      const customSlide = slide as any;
      // You should ensure attachment.fileSource is correctly passed,
      // or derive it from customSlide.fileSource if you stored it there.
      return (
        <div className="flex items-center justify-center h-full w-full">
          <DocViewer
            style={{ height: "70vh", width: "80vh" }}
            pluginRenderers={DocViewerRenderers}
            documents={[
              {
                uri: customSlide.fileSource, // Use fileSource stored in custom slide
                fileType: customSlide.fileType,
              },
            ]}
            config={{
              header: {
                disableHeader: true,
                disableFileName: true,
                // disableDownload: true,
              },
            }}
          />
        </div>
      );
    }
    // --- Handle Generic Embed Slides (PDFs, etc.) ---
    else if (
      (slide as any).fileType &&
      !(slide as any).fileType.startsWith("image/") &&
      !(slide as any).fileType.startsWith("video/")
    ) {
      const customSlide = slide as any;
      return (
        <div className="flex items-center justify-center h-full w-full">
          <embed
            className="sm:min-h-[70svh] carousel-document" // Keep your styles
            type={customSlide.fileType}
            width="100%"
            src={customSlide.src} // Use src property from the slide
          />
        </div>
      );
    }
    // For images, return null as YARL handles them by default
    return null;
  };

  const handleClose = () => {
    setIsOpen(false);
    closeCallback();
  };

  // Custom toolbar with download button
  const customToolbar = ({ toolbar }: any) => {
    const currentAttachment = attachments[index];

    return (
      <div className="yarl__toolbar">
        <div className="yarl__toolbar_left">
          {/* File type badge */}
          <span className="text-black bg-white text-content rounded-[2px] p-1 h-fit mr-2">
            {currentAttachment?.fileType.split("/")?.pop()?.toUpperCase()}
          </span>
          {/* File name */}
          <span className="text-content text-white font-bold">
            {currentAttachment?.fileName}
          </span>
        </div>

        <div className="yarl__toolbar_right">
          {/* Standard YARL toolbar items (e.g., zoom, fullscreen) */}
          {toolbar.items.map((item: any, i: number) => {
            // Filter out the default download button if you have a custom one
            if (item.key === "download") return null;
            return <React.Fragment key={i}>{item}</React.Fragment>;
          })}

          {/* Custom Download button */}
          <button
            className="yarl__button" // Use YARL's button class for consistent styling
            onClick={() =>
              handleDownload(
                currentAttachment.fileSource,
                currentAttachment.fileName
              )
            }
            title="Download"
          >
            <DownloadButton />
          </button>
        </div>
      </div>
    );
  };

  return (
    <Lightbox
      open={isOpen}
      close={handleClose}
      slides={slides}
      index={index}
      on={{
        view: ({ index: newIndex }: { index: number }) => setIndex(newIndex),
      }}
      // Include the necessary plugins
      plugins={[Zoom, Download, Fullscreen, ...(isMbl ? [] : [Thumbnails])]}
      zoom={{
        maxZoomPixelRatio: 3,
        zoomInMultiplier: 2,
        doubleTapDelay: 300,
        doubleClickDelay: 300,
        doubleClickMaxStops: 2,
        keyboardMoveDistance: 50,
        wheelZoomDistanceFactor: 100,
        pinchZoomDistanceFactor: 100,
        scrollToZoom: true,
      }}
      thumbnails={{
        position: "bottom",
        width: 120,
        height: 80,
        border: 1,
        borderRadius: 4,
        padding: 4,
        gap: 16,
        imageFit: "cover",
      }}
      download={{
        download: () => {
          const currentAttachment = attachments[index];
          handleDownload(
            currentAttachment.fileSource,
            currentAttachment.fileName
          );
        },
      }}
      render={{
        slide: renderSlide,
        // toolbar: customToolbar, // Use your custom toolbar
      }}
      controller={{
        closeOnBackdropClick: true,
        closeOnPullDown: true,
        closeOnPullUp: true,
      }}
      carousel={{
        finite: true,
        preload: 2,
        padding: isMbl ? "16px" : "64px",
        spacing: isMbl ? "30%" : "20%",
        imageFit: "contain",
      }}
      styles={{
        container: {
          backgroundColor: "rgba(0, 0, 0, 0.9)",
        },
        // Remove toolbar style here as it's now handled in customToolbar's JSX
        // toolbar: {
        //   backgroundColor: "rgba(0, 0, 0, 0.8)",
        //   padding: isMbl ? "8px 16px" : "16px 32px",
        // },
      }}
      animation={{
        fade: 0,
        swipe: 500,
      }}
    />
  );
};

export default AttachmentCarousel;

const DownloadButton = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M8 12L3 7L4.4 5.55L7 8.15V0H9V8.15L11.6 5.55L13 7L8 12ZM2 16C1.45 16 0.979333 15.8043 0.588 15.413C0.196666 15.0217 0.000666667 14.5507 0 14V11H2V14H14V11H16V14C16 14.55 15.8043 15.021 15.413 15.413C15.0217 15.805 14.5507 16.0007 14 16H2Z"
        fill="white"
      />
    </svg>
  );
};
