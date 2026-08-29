import { useRef } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import {
  IAnnouncement,
  youtubeThumbnailUrl,
} from "@/models/Announcements/model";
import { prefixUseGetAnnouncements } from "@/hooks/MultiPages/Sidebar/useGetAnnouncements";
import { handleAnnouncementCtaClick } from "../AnnouncementSlide/announcementCta";

interface IProps {
  announcement: IAnnouncement;
  userId: number;
  onDismiss: () => void;
}

const AnnouncementBanner: React.FC<IProps> = ({
  announcement,
  userId,
  onDismiss,
}) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const dismissed = useRef(false);
  const { title, content, mediaURL, articleURL, primaryCTA } =
    announcement.announcement.body;

  const dismiss = () => {
    if (dismissed.current) return;
    dismissed.current = true;

    const readAt = new Date().toISOString();
    queryClient.setQueryData(
      [prefixUseGetAnnouncements, userId],
      (previous: IAnnouncement[] | undefined) =>
        Array.isArray(previous)
          ? previous.map((item) =>
              item.announcementId === announcement.announcementId
                ? { ...item, readAt }
                : item
            )
          : previous
    );
    onDismiss();
    void axios
      .post("/api/users/announcements/getUserAnnouncements", {
        userId,
        announcementIds: [announcement.announcementId],
      })
      .catch((error) => console.error("Failed to dismiss announcement", error));
  };

  const poster = youtubeThumbnailUrl(mediaURL);

  // The poster and the button go to the same place: for a video that is YouTube,
  // opened in a new tab by handleAnnouncementCtaClick.
  const ctaTarget = articleURL || (poster ? mediaURL : "");

  const handleCta = () => {
    if (!ctaTarget) return;
    dismiss();
    handleAnnouncementCtaClick(ctaTarget, router);
  };

  return (
    <aside className="fixed bottom-[56px] left-[12px] right-[12px] z-[100] w-auto rounded-[4px] bg-modalBackground p-[14px] text-white-black shadow-lg sm:left-auto sm:right-[20px] sm:w-[330px]">
      <div className="mb-3 flex items-center justify-between">
        {/* same unread marker the rocket sidebar uses on a new announcement */}
        <span className="flex items-center gap-2">
          <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#51A4F1]" />
          <span className="text-micro uppercase tracking-wider text-text-light-gray">
            New
          </span>
        </span>
        <button type="button" onClick={dismiss} aria-label="Dismiss announcement">
          <X size={18} strokeWidth={1.75} />
        </button>
      </div>

      {mediaURL && (
        // 16:9, never a fixed height — the poster is a 16:9 frame and anything
        // else letterboxes it. A video is a poster that opens YouTube in a new
        // tab; nothing plays inside the card.
        <div className="relative mb-3 aspect-video w-full overflow-hidden rounded-[5px] bg-cardBackground">
          {poster ? (
            <button
              type="button"
              onClick={handleCta}
              aria-label={`Watch: ${title}`}
              className="block h-full w-full"
            >
              <img
                src={poster}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
              <span className="absolute inset-0 flex items-center justify-center">
                <svg width="34" height="34" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.55)" />
                  <path d="M10 8.2 16.2 12 10 15.8z" fill="#ffffff" />
                </svg>
              </span>
            </button>
          ) : (
            <img
              src={mediaURL}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          )}
        </div>
      )}

      <h2 className="text-content font-semibold text-white-black">{title}</h2>
      {content && (
        <p className="mt-1 text-content font-normal text-text-light-gray">
          {content}
        </p>
      )}

      {ctaTarget && (
        <div className="mt-4 flex items-center">
          <button
            type="button"
            onClick={handleCta}
            className="rounded bg-label-span px-4 py-2"
          >
            {primaryCTA || "Try it now"}
          </button>
        </div>
      )}
    </aside>
  );
};

export default AnnouncementBanner;
