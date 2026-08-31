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
  announcements.some(
    (announcement) =>
      typeof announcement === "object" &&
      announcement !== null &&
      "readAt" in announcement &&
      !(announcement as Pick<IAnnouncement, "readAt">).readAt,
  );

export const MobileAnnouncementIndicator = ({ visible }: { visible: boolean }) =>
  visible ? (
    <span
      aria-hidden="true"
      className="h-[7px] w-[7px] shrink-0 rounded-full bg-[#51A4F1]"
    />
  ) : null;
