export type AnnouncementLevel =
  | "note"
  | "link"
  | "video"
  | "banner"
  | "takeover";

export interface ISlideAnnouncement {
  headline: string;
  content: string;
  mediaURL: string;
  articleURL: string;
  primaryCTA: string;
}

export interface IAnnouncementBody {
  title: string;
  blogURL: string;
  content: string;
  newUserMark: boolean;
  level?: AnnouncementLevel;
  mediaURL?: string;
  articleURL?: string;
  primaryCTA?: string;
  slides?: ISlideAnnouncement[];
}

const ANNOUNCEMENT_LEVELS: AnnouncementLevel[] = [
  "note",
  "link",
  "video",
  "banner",
  "takeover",
];

/** The level only when it was published explicitly. Legacy records return undefined. */
export const getExplicitLevel = (
  body: Partial<IAnnouncementBody>
): AnnouncementLevel | undefined =>
  ANNOUNCEMENT_LEVELS.includes(body.level as AnnouncementLevel)
    ? (body.level as AnnouncementLevel)
    : undefined;

export const resolveLevel = (
  body: Partial<IAnnouncementBody>
): AnnouncementLevel => {
  const explicit = getExplicitLevel(body);
  if (explicit) return explicit;
  // Fallback mirrors the shipped sidebar precedence: a blogURL always won over slides.
  if (body.blogURL) return "link";
  if (body.slides?.length) return "takeover";
  return "note";
};

/** Poster for a YouTube embed URL. Loom/mp4/plain images return null. */
export const youtubeThumbnailUrl = (mediaURL?: string): string | null => {
  const id = mediaURL?.match(/youtube\.com\/embed\/([\w-]+)/)?.[1];
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
};

export const getAnnouncementSlides = (
  body: IAnnouncementBody
): ISlideAnnouncement[] => {
  const level = resolveLevel(body);
  if (level === "takeover") return body.slides ?? [];
  if (level !== "video" && level !== "banner") return [];

  return [
    {
      headline: body.title,
      content: body.content,
      mediaURL: body.mediaURL ?? "",
      articleURL: body.articleURL ?? "",
      primaryCTA: body.primaryCTA ?? "",
    },
  ];
};

export interface IAnnouncement {
  id: string;
  userId: number;
  announcementId: number;
  readAt: string | null;
  createdAt: string;
  announcement: {
    id: number;
    createdAt: string;
    isActive: boolean;
    body: IAnnouncementBody;
  };
}

export interface IAnnouncementPosts {
  allPosts: IAnnouncement[];
}
