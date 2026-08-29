"use client";

import UserPreferenceSidebar from "@/components/sidebars/RightSidebar/UserPreference";
import { useRecoilState } from "@/lib/state";
import { openAiChatByDefaultAtom } from "@/store";
import SettingsCard from "./SettingsCard";
import SettingsScrollPicker from "./SettingsScrollPicker";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const TaskPageSection = () => {
  const [openAiChatByDefault, setOpenAiChatByDefault] = useRecoilState(
    openAiChatByDefaultAtom
  );

  return (
    <SettingsSectionShell title="Task page">
      <SettingsCard title="Task Page">
        <UserPreferenceSidebar ToggleComponent={SettingsToggle} />
        <SettingsToggle
          label="Open AI chat by default"
          inputId="open-ai-chat-by-default"
          value={openAiChatByDefault}
          checked={openAiChatByDefault}
          onChange={() => setOpenAiChatByDefault((previous) => !previous)}
        />
        <SettingsScrollPicker />
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default TaskPageSection;
