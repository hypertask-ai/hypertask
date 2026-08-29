"use client";

import SettingsSectionShell from "./SettingsSectionShell";
import SkillLibrary from "./SkillLibrary";
import { useSettingsTeam } from "./useSettingsTeam";

export default function SkillsSection() {
  const { teamId } = useSettingsTeam();

  return (
    <SettingsSectionShell title="Skills">
      <p className="text-dense font-medium text-text-light-gray">
        Type /slug in AI chat, or @hyperai /slug in a comment.
      </p>
      <SkillLibrary scope="user" teamId={teamId} />
    </SettingsSectionShell>
  );
}
