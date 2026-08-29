import BackDropContainer from "../BackDropContainer";
import { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useRecoilState } from "@/lib/state";
import { announcementSlideAtom, currentUserAtom } from "@/store";
import {
  getAnnouncementSlides,
  IAnnouncement,
  ISlideAnnouncement,
  resolveLevel,
  youtubeThumbnailUrl,
} from "@/models/Announcements/model";
import { useAnnouncementMute } from "@/hooks/General/useGetUserPreferences";
import { prefixUseGetAnnouncements } from "@/hooks/MultiPages/Sidebar/useGetAnnouncements";
import { useQueryClient } from "@tanstack/react-query";

// Announcements are authored by the owner via the CLI (scripts/announce.mjs).
// This component is read-only: it lists announcements and marks them read.

const YOUTUBE_URL = "https://www.youtube.com/@hypertasks";
const X_URL = "https://x.com/hypertasks";

interface IPosts {
  allPosts: IAnnouncement[];
  toggleSidebar: () => void;
  placement?: "left" | "right";
}

const shortDate = (iso: string) => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

// ======================================================= Announcements =============================================
const Announcements: React.FC<IPosts> = ({
  allPosts,
  toggleSidebar,
  placement = "right",
}) => {
  const { muted, toggleMute } = useAnnouncementMute();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <BackDropContainer
      className={`transition-opacity duration-[225ms] ease-out ${
        isVisible ? "opacity-100" : "opacity-0"
      } ${placement === "left" ? "left-0 top-0" : ""}`}
    >
      <div
        id="announcements-component-container"
        className={`fixed bg-sidebar text-white-black top-0 flex flex-col h-SVH-full z-[100] xs:w-[80vw] sm:w-[450px] transform transition-transform duration-[225ms] ease-out will-change-transform ${
          placement === "left" ? "left-[var(--app-shell-rail-w,48px)]" : "right-0"
        } ${
          isVisible
            ? "translate-x-0"
            : placement === "left"
              ? "-translate-x-full"
              : "translate-x-full"
        }`}
      >
        {/* header */}
        <div className="flex justify-between items-center xs:px-3 sm:px-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-3">
          <h2 className="font-semibold text-subheading">Latest Updates 🚀</h2>
          <button
            onClick={toggleMute}
            className="text-meta text-text-light-gray hover:text-white-black"
            title={
              muted
                ? "Turn announcement alerts back on"
                : "Stop the rocket lighting up for new announcements"
            }
          >
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>

        {/* list */}
        <div className="flex-1 overflow-y-auto xs:px-3 sm:px-6">
          <AnnouncementPosts
            allPosts={allPosts}
            toggleSidebar={toggleSidebar}
          />
        </div>

        {/* channels */}
        <ChannelsFooter />
      </div>
    </BackDropContainer>
  );
};

// ====================================================== Posts ==============================================
export const AnnouncementPosts = ({
  allPosts,
  toggleSidebar,
}: {
  allPosts: IAnnouncement[];
  toggleSidebar?: () => void;
}) => {
  const [currentUser] = useRecoilState(currentUserAtom);
  const queryClient = useQueryClient();

  // Mark read in the cache as well as on the server. The POST is fire-and-forget
  // and closing the panel used to refetch immediately, so on a slow connection
  // the GET could answer before the POST committed and cache readAt: null again,
  // leaving the rocket lit (HTPR-4652). Writing the cache here makes the unread
  // dot depend on the click, not on the request ordering.
  useEffect(() => {
    const markAllAsRead = async () => {
      if (!allPosts?.length || !currentUser) return;
      const readAt = new Date().toISOString();
      queryClient.setQueryData(
        [prefixUseGetAnnouncements, currentUser.id],
        (previous: IAnnouncement[] | undefined) =>
          Array.isArray(previous)
            ? previous.map((post) => (post.readAt ? post : { ...post, readAt }))
            : previous
      );
      await axios.post("/api/users/announcements/getUserAnnouncements", {
        userId: currentUser.id,
        announcementIds: allPosts.map((a) => a.announcementId),
      });
    };
    markAllAsRead();
  }, [allPosts?.length, currentUser, queryClient]);

  return (
    <div className="flex flex-col">
      {allPosts?.map((post, index) => (
        <SinglePost
          post={post}
          key={`announcement-sidebar-post-${index}`}
          toggleSidebar={toggleSidebar}
        />
      ))}
    </div>
  );
};

// ponytail: every announcement video is a YouTube embed, so the poster comes
// free from img.youtube.com. Loom/mp4 slides simply get no thumbnail.
const youtubeThumbnail = (slides?: ISlideAnnouncement[]) =>
  slides?.map((slide) => youtubeThumbnailUrl(slide.mediaURL)).find(Boolean) ??
  null;

const VideoThumbnail = ({ src }: { src: string }) => (
  <span className="relative mt-[2px] block h-[54px] w-[96px] shrink-0 overflow-hidden rounded-[5px]">
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
    />
    <span className="absolute inset-0 flex items-center justify-center">
      <svg width="22" height="22" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.55)" />
        <path d="M10 8.2 16.2 12 10 15.8z" fill="#ffffff" />
      </svg>
    </span>
  </span>
);

// ======================================================= SinglePost =============================================
const SinglePost: React.FC<{
  post: IAnnouncement;
  toggleSidebar?: () => void;
}> = ({ post, toggleSidebar }) => {
  const [, setShowAnnouncmentSlide] = useRecoilState(announcementSlideAtom);
  const { title, content, blogURL } = post.announcement.body;
  const level = resolveLevel(post.announcement.body);
  const announcementSlides = getAnnouncementSlides(post.announcement.body);
  const hasBlogURL = !!blogURL && blogURL.length > 0;
  const opensModal =
    (level === "video" || level === "banner" || level === "takeover") &&
    announcementSlides.length > 0;
  const thumbnail = youtubeThumbnail(announcementSlides);

  const Inner = (
    <div className="flex gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {!post.readAt && (
            <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#51A4F1]" />
          )}
          <span className="text-content font-semibold text-white-black">
            {title}
          </span>
          <span className="ml-auto shrink-0 text-micro text-text-light-gray">
            {shortDate(post.createdAt)}
          </span>
        </div>
        {content && (
          <p className="mt-1 text-content font-normal text-text-light-gray line-clamp-2 break-words">
            {content}
          </p>
        )}
      </div>
      {thumbnail && <VideoThumbnail src={thumbnail} />}
    </div>
  );

  return (
    <div className="border-b border-border last:border-b-0">
      {level === "link" && hasBlogURL ? (
        <Link
          target="_blank"
          rel="noopener noreferrer"
          href={blogURL}
          className="block py-3.5"
        >
          {Inner}
        </Link>
      ) : opensModal ? (
        <div
          className="py-3.5 cursor-pointer"
          onClick={() => {
            setShowAnnouncmentSlide(post);
            toggleSidebar?.();
          }}
        >
          {Inner}
        </div>
      ) : (
        <div className="py-3.5">{Inner}</div>
      )}
    </div>
  );
};

// ==================================================== ChannelsFooter =========================================
const ChannelsFooter = () => (
  <div className="border-t border-border xs:px-3 sm:px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
    <p className="mb-2 text-micro uppercase tracking-wider text-text-light-gray">
      Follow along
    </p>
    <div className="flex flex-col">
      <ChannelRow
        href={YOUTUBE_URL}
        label="YouTube"
        sub="@hypertasks · feature demos"
        iconBg="rgba(255,61,61,0.14)"
        icon={
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#FF3D3D">
            <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6z" />
          </svg>
        }
      />
      <ChannelRow
        href={X_URL}
        label="X"
        sub="@hypertasks · follow updates"
        iconBg="#000000"
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#ffffff">
            <path d="M18.9 1.1h3.7l-8 9.1L24 22.9h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.8L0 1.1h7.6l5.2 6.9zM17.6 20.7h2L6.5 3.2H4.3z" />
          </svg>
        }
      />
    </div>
  </div>
);

const ChannelRow = ({
  href,
  label,
  sub,
  icon,
  iconBg,
}: {
  href: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
  iconBg: string;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-active-elementBg"
  >
    <span
      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md"
      style={{ background: iconBg }}
    >
      {icon}
    </span>
    <span className="flex flex-col leading-tight">
      <span className="text-content font-semibold text-white-black">
        {label}
      </span>
      <span className="text-meta text-text-light-gray">{sub}</span>
    </span>
    <span className="ml-auto text-text-light-gray">↗</span>
  </a>
);

export default Announcements;
