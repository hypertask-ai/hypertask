"use client";

import { useMemo } from "react";
import { Rocket } from "lucide-react";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import { useGetAnnouncements } from "@/hooks/MultiPages/Sidebar/useGetAnnouncements";
import { useGlobalUIState } from "@/components/ProviderGlobal/useGlobalUIState";
import type { IAnnouncement } from "@/models/Announcements/model";
import { MOBILE_TARGET } from "@/lib/configs/general.config";

const MobileAnnouncementButton = ({ currentUserId }: { currentUserId: number }) => {
  const { toggleAnnouncements } = useGlobalUIState();
  const { data: announcementsData } = useGetAnnouncements(currentUserId);
  const { data: userPrefs } = useGetUserPreferences();
  const hasUnreadAnnouncement = useMemo(
    () =>
      !userPrefs?.muteAnnouncements &&
      Array.isArray(announcementsData) &&
      (announcementsData as IAnnouncement[]).some(
        (announcement) => !announcement.readAt,
      ),
    [announcementsData, userPrefs?.muteAnnouncements],
  );

  if (!hasUnreadAnnouncement) return null;

  return (
    <button
      type="button"
      aria-label="Latest updates"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={toggleAnnouncements}
      className={`${MOBILE_TARGET} text-white-black hover:text-white-black`}
    >
      <Rocket size={18} strokeWidth={1.75} />
    </button>
  );
};

export default MobileAnnouncementButton;
