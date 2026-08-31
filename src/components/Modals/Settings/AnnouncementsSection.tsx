"use client";

import { useMemo } from "react";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { IAnnouncement } from "@/models/Announcements/model";
import { useAnnouncementMute } from "@/hooks/General/useGetUserPreferences";
import { useGetAnnouncements } from "@/hooks/MultiPages/Sidebar/useGetAnnouncements";
import { AnnouncementPosts } from "@/components/sidebars/Announcements";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const AnnouncementsSection = () => {
  const currentUser = useRecoilValue(currentUserAtom);
  const { data: announcementsData } = useGetAnnouncements(currentUser.id);
  const { muted, toggleMute } = useAnnouncementMute();
  const announcements = useMemo(
    () =>
      Array.isArray(announcementsData)
        ? (announcementsData as IAnnouncement[])
        : [],
    [announcementsData]
  );

  return (
    <SettingsSectionShell title="Latest updates">
      <SettingsCard>
        <div className="flex items-center justify-between gap-4 rounded-[5px] px-2 py-2 hover:bg-hover-active">
          <div className="min-w-0 flex-1">
            <div className="text-dense font-semibold text-white-black">
              Announcement alerts
            </div>
            <p className="mt-1 text-dense font-medium leading-snug text-text-light-gray">
              Show an unread indicator when new updates are available.
            </p>
          </div>
          <SettingsToggle
            checked={!muted}
            hideLabel
            inputId="settings-announcement-alerts"
            label="Announcement alerts"
            onChange={toggleMute}
          />
        </div>
      </SettingsCard>
      <AnnouncementPosts allPosts={announcements} />
    </SettingsSectionShell>
  );
};

export default AnnouncementsSection;
