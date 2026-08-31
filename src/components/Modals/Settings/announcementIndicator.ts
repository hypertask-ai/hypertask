import type { IAnnouncement } from "@/models/Announcements/model";

interface MobileAnnouncementIndicatorState {
  announcements: unknown;
  mobile: boolean;
  muted: boolean | undefined;
  preferencesFetched: boolean;
}

export const shouldShowMobileAnnouncementIndicator = ({
  announcements,
  mobile,
  muted,
  preferencesFetched,
}: MobileAnnouncementIndicatorState): boolean =>
  mobile &&
  preferencesFetched &&
  muted === false &&
  Array.isArray(announcements) &&
  (announcements as IAnnouncement[]).some(
    (announcement) => !announcement.readAt,
  );
