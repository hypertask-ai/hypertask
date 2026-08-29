import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import "@/styles/AttachmentView.scss";
import { ModalHeader } from "reactstrap";
import React, { useContext, useState } from "react";
import { ModalBody, ModalFooter } from "reactstrap";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import { ISlideAnnouncement } from "@/models/Announcements/model";
import { X } from "lucide-react";
import InnerHTMLDescription from "@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/InnerHtmlDescription";
import { useRouter } from "next/navigation";
import { handleAnnouncementCtaClick } from "./announcementCta";

interface IProps {
  announcementSlides: ISlideAnnouncement[];
  toggle: () => void;
  createMode?: "Update" | "Submit";
  createCallback?: (type: "Edit" | "Submit" | "Update") => void;
}

const AnnouncementSlideModal: React.FC<IProps> = ({
  announcementSlides,
  toggle,
  createCallback,
  createMode,
}) => {
  const isMbl = useContext(MobileViewContext);
  const [slides, __] = useState<ISlideAnnouncement[]>(announcementSlides ?? []);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const router = useRouter();

  // Every render below dereferences slides[currentIndex], so an announcement
  // published without slides would crash this globally-mounted modal.
  const slide = slides[currentIndex];
  if (!slide) return null;

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="announcement-slides-modal"
      toggle={toggle}
      shouldCloseOnClickOutside={true}
      contentClassName={`h-full md:max-h-fit border-none`}
      fullScreen={isMbl}
      className={`font-bold bg-[#333B47] h-full md:max-h-fit border-none md:top-[150px] md:w-full md:min-w-[850px] flex flex-col text-white`}
    >
      <ModalHeader className="rounded-none border-b-0 h-[60px] text-subheading font-bold [&>*:first-child]:w-full mb-0">
        <div className="flex justify-end items-center w-full">
          <div className="w-fit h-fit relative group">
            <X size={18} strokeWidth={1.75}
              onClick={toggle}
              className="cursor-pointer"
              width={18}
              height={18}
            />
          </div>
        </div>
      </ModalHeader>

      <ModalBody className="w-full max-h-fit flex flex-col md:flex-row border-b-0 border-transparent px-10 gap-[15px] py-0 mb-2 md:!mb-0 scrollbar-none justify-between">
        <div className="w-full md:w-[65%] max-h-fit  flex flex-col items-start">
          <InnerHTMLDescription
            descriptionText={slides[currentIndex].content}
            id={`description`}
            key={"announcement-innerHTML description"}
            attachmentsFromProps={[]}
            className="text-white"
          />
        </div>

        {!slide.mediaURL ? null : slides[currentIndex].mediaURL.includes(
            "embed"
          ) ? (
          <div className="h-[252px] w-full video-wrapper mb-[30px]">
            <iframe
              src={slides[currentIndex].mediaURL}
              allowFullScreen={true}
              className="rounded-[5px] h-[252px] w-full"
            />
          </div>
        ) : slides[currentIndex].mediaURL.includes(".mp4") ? (
          <div className="h-[252px] w-full video-wrapper mb-[30px]">
            <video
              controls
              autoPlay={false}
              preload="auto"
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain" }}
            >
              <source
                key={0}
                src={slides[currentIndex].mediaURL}
                type={"video/mp4"}
              />
            </video>
          </div>
        ) : (
          <div className={`w-full max-h-[352px] mb-[30px]`}>
            <img
              src={slides[currentIndex].mediaURL}
              alt="announcement-modal-image"
              className="object-contain rounded-md max-h-inherit w-fit place-self-end"
            />
          </div>
        )}
      </ModalBody>
      {((createMode && createCallback) ||
        (slides[currentIndex].articleURL &&
          slides[currentIndex].articleURL.length > 0)) && (
        <ModalFooter className="w-full items-center justify-center border-t-0 pb-4 px-10 pt-0">
          <div
            className="flex w-full justify-between items-center"
            id="bottom-buttons"
          >
            <div className="flex flex-row-reverse justify-between gap-3 w-full">
              {slides.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (currentIndex + 1 > slides.length - 1) return toggle();
                    setCurrentIndex((prev) => prev + 1);
                  }}
                  className="py-2 bg-[#333B47] rounded w-fit cursor-pointer"
                >
                  {currentIndex + 1 > slides.length - 1 ? "CLOSE" : "NEXT"}
                </button>
              )}
              {slides[currentIndex].articleURL &&
              slides[currentIndex].articleURL.length > 0 ? (
                <button
                  onClick={() =>
                    handleAnnouncementCtaClick(
                      slides[currentIndex].articleURL,
                      router,
                      toggle
                    )
                  }
                  className="px-10 py-2 bg-[#4f5766] rounded transition-colors duration-200 w-fit cursor-pointer"
                >
                  {slides[currentIndex].primaryCTA &&
                  slides[currentIndex].primaryCTA.length > 0
                    ? slides[currentIndex].primaryCTA
                    : "LEARN MORE"}
                </button>
              ) : (
                <></>
              )}
            </div>
            {createMode && createCallback && (
              <div className="flex justify-start gap-3 ml-3">
                <button
                  type="button"
                  onClick={() => createCallback("Edit")}
                  className="px-4 py-2 bg-blue-600 rounded w-fit cursor-pointer"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => createCallback(createMode)}
                  className="px-4 py-2 bg-blue-600 rounded w-fit cursor-pointer"
                >
                  {createMode}
                </button>
              </div>
            )}
          </div>
        </ModalFooter>
      )}
    </ModalContainerCustom>
  );
};

export default AnnouncementSlideModal;
