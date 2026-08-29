"use client";

import UserPreferenceSidebar from "@/components/sidebars/RightSidebar/UserPreference";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const InboxSection = () => (
  <SettingsSectionShell title="Inbox">
    <SettingsCard title="Inbox behaviour">
      <UserPreferenceSidebar ToggleComponent={SettingsToggle} variant="inbox" />
    </SettingsCard>
  </SettingsSectionShell>
);

export default InboxSection;
