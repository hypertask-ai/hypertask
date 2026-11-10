"use client";

import { useFlag } from "@/hooks/useFlag";
import { useCardParts, useSetCardPart } from "@/hooks/General/useCardParts";
import { HTPR_8971_CARD_SETTINGS_FLAG } from "@/lib/flags/definitions/htpr-8971-card-settings";
import { CARD_PARTS } from "@/lib/kanban/cardParts";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import SettingsToggle from "./SettingsToggle";

const noop = () => {};

const CardSettingsSection = () => {
  const cardSettings = useFlag(HTPR_8971_CARD_SETTINGS_FLAG);
  const parts = useCardParts();
  const setPart = useSetCardPart();
  const rows = [];
  for (const part of CARD_PARTS) {
    const description = "description" in part ? part.description : undefined;
    rows.push(
      <SettingsToggle
        key={part.key}
        label={part.label}
        description={description}
        inputId={`card-part-${part.key}`}
        value={parts[part.key]}
        checked={parts[part.key]}
        onChange={() => void setPart(part.key, !parts[part.key])}
      />,
    );
  }
  return cardSettings ? (
    <SettingsSectionShell title="Card settings" description="Only affects you. Every board.">
      <SettingsCard>
        <SettingsToggle label="Name" description="Always shown" inputId="card-part-name" value checked disabled onChange={noop} />
        <SettingsToggle label="People" description="Always shown" inputId="card-part-people" value checked disabled onChange={noop} />
        {rows}
      </SettingsCard>
    </SettingsSectionShell>
  ) : null;
};

export default CardSettingsSection;
