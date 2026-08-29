"use client";

import EmailNotificationSidebar from "@/components/sidebars/RightSidebar/Notifications Sidebar/EmailNotificationsSidebar";
import PushNotificationSidebar from "@/components/sidebars/RightSidebar/Notifications Sidebar/PushNotificationSidebar";
import NotificationMatrix from "./NotificationMatrix";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const NotificationsSection = () => {
  return (
    <SettingsSectionShell title="Notifications">
      <SettingsCard title="What to notify me about">
        <NotificationMatrix />
      </SettingsCard>
      <SettingsCard title="Email">
        <EmailNotificationSidebar ToggleComponent={SettingsToggle} />
      </SettingsCard>
      <SettingsCard title="Push">
        <PushNotificationSidebar ToggleComponent={SettingsToggle} />
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default NotificationsSection;
