import { IAttachment } from "@/models/model";
import {
  isBrowserRenderableImage,
  isUnrenderableImage,
} from "@/lib/media/browserRenderableImage";
import { heicPreviewUrl } from "@/lib/media/heicPreview";
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
      const anchor = document.createElement("a");
      anchor.href = data.downloadUrl;
      anchor.download = fileName;
      anchor.click();
    } catch (error) {
      console.error("Error downloading file:", error);
    }
  };

  const filesToCheck = ["xlsx", "docx", "doc", "pptx", "ppt"];

  const renderableImage = (fileType?: string | null, fileName?: string | null) =>
    isBrowserRenderableImage(fileType, fileName);

  const [previewLoaded, setPreviewLoaded] = useState<Record<string, boolean>>({});

  const previewIsShowable = (url: string) => previewLoaded[url] !== false;

  useEffect(() => {
    let cancelled = false;
    const images: HTMLImageElement[] = [];

    attachments.forEach((attachment) => {
      const url = heicPreviewUrl(
        attachment.fileSource,
        attachment.fileType,
        attachment.fileName
      );
      if (!url) return;
      const image = new Image();
      images.push(image);
      const settle = (ok: boolean) => {
        if (cancelled) return;
        setPreviewLoaded((current) =>
          current[url] === ok ? current : { ...current, [url]: ok }
        );
      };
      image.onload = () => settle(true);
      image.onerror = () => settle(false);
      image.src = url;
    });

    return () => {
      cancelled = true;
      images.forEach((image) => {
        image.onload = null;
        image.onerror = null;
      });
    };
  }, [attachments]);


  const slides: Slide[] = attachments.map((attachment) => {
    const attachmentUpdated = attachment.fileSource;

    const previewUrl = heicPreviewUrl(
      attachment.fileSource,
      attachment.fileType,
      attachment.fileName
    );
    if (previewUrl && previewIsShowable(previewUrl)) {
      return {
        src: previewUrl,
        alt: attachment.fileName,
        width: 1200,
        height: 800,
      } as Slide;
    }

    if (renderableImage(attachment.fileType, attachment.fileName)) {
      return {
        src: attachmentUpdated,
        alt: attachment.fileName,
        width: 1200,
        height: 800,
      };
    } else if (attachment.fileType.startsWith("video/")) {
      return {
        type: "video" as const,
        sources: [
          {
            src: attachmentUpdated,
            type: attachment.fileType,
          },
        ],
        fileName: attachment.fileName,
      };
    } else {
      return {
        src: attachmentUpdated,
        title: attachment.fileName,
        alt: attachment.fileName,
        fileType: attachment.fileType,
        fileName: attachment.fileName,
        fileSource: attachment.fileSource,
      };
    }
  });

  const renderSlide = ({ slide, rect }: { slide: Slide; rect: any }) => {
    if (slide.type === "video" && slide.sources) {
      const originalAttachment = attachments.find(
        (att) => att.fileName === (slide as any).fileName
      );

      return (
        <div className="flex items-center justify-center h-full w-full">
          <video
            controls
            autoPlay={false}
            preload="auto"
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          >
            {slide.sources.map((source, idx) => (
              <source key={idx} src={source.src} type={source.type} />
            ))}
            Your browser does not support the video tag.
          </video>
        </div>
      );
    }
    else if (
      (slide as any).fileType &&
      filesToCheck.some((x) => (slide as any).fileName.endsWith(x))
    ) {
      const customSlide = slide as any;
      return (
        <div className="flex items-center justify-center h-full w-full">
          <DocViewer
            style={{ height: "70vh", width: "80vh" }}
            pluginRenderers={DocViewerRenderers}
            documents={[
              {
                uri: customSlide.fileSource,
                fileType: customSlide.fileType,
              },
            ]}
            config={{
              header: {
                disableHeader: true,
                disableFileName: true,
              },
            }}
          />
        </div>
      );
    }
    else if (
      (slide as any).fileSource &&
      isUnrenderableImage((slide as any).fileType, (slide as any).fileName)
    ) {
      const customSlide = slide as any;
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-white-black">
          <span className="max-w-[80vw] truncate text-dense">
            {customSlide.fileName}
          </span>
          <span className="text-micro text-text-light-gray">
            This image format cannot be shown in a browser.
          </span>
          <button
            type="button"
            onClick={() =>
              handleDownload(customSlide.fileSource, customSlide.fileName)
            }
            className="rounded-[5px] bg-shadcn-primary px-3 py-2 text-dense text-primary-foreground"
          >
            Download
          </button>
        </div>
      );
    }
    else if (
      (slide as any).fileType &&
      !renderableImage((slide as any).fileType, (slide as any).fileName) &&
      !(slide as any).fileType.startsWith("video/")
    ) {
      const customSlide = slide as any;
      return (
        <div className="flex items-center justify-center h-full w-full">
          <embed
            className="sm:min-h-[70svh] carousel-document"
            type={customSlide.fileType}
            width="100%"
            src={customSlide.src}
          />
        </div>
      );
    }
    return null;
  };

  const renderThumbnail = ({ slide }: { slide: Slide }) => {
    const customSlide = slide as any;
    if (
      customSlide.fileType &&
      !isBrowserRenderableImage(customSlide.fileType, customSlide.fileName)
    ) {
      return (
        <svg
          className="yarl__thumbnails_thumbnail_icon"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <g fill="currentColor">
            <path d="M0 0h24v24H0z" fill="none" />
            <path d="M23 18V6c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zM8.5 12.5l2.5 3.01L14.5 11l4.5 6H5l3.5-4.5z" />
          </g>
        </svg>
      );
    }
    return undefined;
  };

  const handleClose = () => {
    setIsOpen(false);
    closeCallback();
  };

  const customToolbar = ({ toolbar }: any) => {
    const currentAttachment = attachments[index];

    return (
      <div className="yarl__toolbar">
        <div className="yarl__toolbar_left">
          <span className="text-black bg-white text-content rounded-[2px] p-1 h-fit mr-2">
            {currentAttachment?.fileType.split("/")?.pop()?.toUpperCase()}
          </span>
          <span className="text-content text-white font-bold">
            {currentAttachment?.fileName}
          </span>
        </div>

        <div className="yarl__toolbar_right">
          {toolbar.items.map((item: any, i: number) => {
            if (item.key === "download") return null;
            return <React.Fragment key={i}>{item}</React.Fragment>;
          })}

          <button
            className="yarl__button"
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
        thumbnail: renderThumbnail,
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
