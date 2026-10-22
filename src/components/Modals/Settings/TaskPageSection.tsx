"use client";

import UserPreferenceSidebar from "@/components/sidebars/RightSidebar/UserPreference";
import { useRecoilState } from "@/lib/state";
import { keepAiChatClosedAtom, openAiChatByDefaultAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG } from "@/lib/flags/keys";
import SettingsCard from "./SettingsCard";
import SettingsScrollPicker from "./SettingsScrollPicker";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const TaskPageSection = () => {
  const [openAiChatByDefault, setOpenAiChatByDefault] = useRecoilState(
    openAiChatByDefaultAtom
  );

  const keepAiChatClosedEnabled = useFlag(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const [keepAiChatClosed, setKeepAiChatClosed] = useRecoilState(keepAiChatClosedAtom);

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
        {keepAiChatClosedEnabled && (
          <SettingsToggle
            label="Keep AI chat closed always"
            inputId="keep-ai-chat-closed-always"
            value={keepAiChatClosed}
            checked={keepAiChatClosed}
            onChange={() => setKeepAiChatClosed((previous) => !previous)}
          />
        )}
        <SettingsScrollPicker />
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default TaskPageSection;
