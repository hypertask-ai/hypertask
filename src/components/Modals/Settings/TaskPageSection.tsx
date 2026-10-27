"use client";

import { HTPR_8088_MANUAL_CHAT_FLAG } from "@/lib/flags/definitions/htpr-8088-manual-chat";
import { useAiChatOpenPreferences } from "@/hooks/General/useAiChatOpenPreferences";
import UserPreferenceSidebar from "@/components/sidebars/RightSidebar/UserPreference";
import { useRecoilState } from "@/lib/state";
import { keepAiChatClosedAtom, openAiChatByDefaultAtom } from "@/store";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG, HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG } from "@/lib/flags/keys";
import SettingsCard from "./SettingsCard";
import SettingsScrollPicker from "./SettingsScrollPicker";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const TaskPageSection = () => {
  const manualChat = useFlag(HTPR_8088_MANUAL_CHAT_FLAG);
  const aiChatOpenSwitchesEnabled = useFlag(HTPR_7650_AI_CHAT_OPEN_SWITCHES_FLAG);
  const { values, setPreference } = useAiChatOpenPreferences();
  const [openAiChatByDefault, setOpenAiChatByDefault] = useRecoilState(
    openAiChatByDefaultAtom
  );

  const keepAiChatClosedEnabled = useFlag(HTPR_7530_KEEP_AI_CHAT_CLOSED_FLAG);
  const [keepAiChatClosed, setKeepAiChatClosed] = useRecoilState(keepAiChatClosedAtom);

  return (
    <SettingsSectionShell title="Task page">
      <SettingsCard title="Task Page">
        <UserPreferenceSidebar ToggleComponent={SettingsToggle} />
        {!manualChat && (aiChatOpenSwitchesEnabled ? (
          <>
            <SettingsToggle
              label="Open AI chat on newly created tickets"
              inputId="ai-chat-open-new-tickets"
              value={values.aiChatOpenNewTickets}
              checked={values.aiChatOpenNewTickets}
              onChange={() => setPreference("aiChatOpenNewTickets", !values.aiChatOpenNewTickets)}
            />
            <SettingsToggle
              label="Open AI chat when I open a ticket"
              inputId="ai-chat-open-tickets"
              value={values.aiChatOpenTickets}
              checked={values.aiChatOpenTickets}
              onChange={() => setPreference("aiChatOpenTickets", !values.aiChatOpenTickets)}
            />
            <SettingsToggle
              label="Open AI chat on boards"
              inputId="ai-chat-open-boards"
              value={values.aiChatOpenBoards}
              checked={values.aiChatOpenBoards}
              onChange={() => setPreference("aiChatOpenBoards", !values.aiChatOpenBoards)}
            />
          </>
        ) : (
          <>
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
          </>
        ))}
        <SettingsScrollPicker />
      </SettingsCard>
    </SettingsSectionShell>
  );
};

export default TaskPageSection;
