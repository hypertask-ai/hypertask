import { IAllCommands } from "@/models/model";
import { CommandGroup } from "./HTCTypes";
import { CARD_SETTINGS_COMMAND } from "./AllCommands";

const CARD_SETTINGS_SHORTCUT_GROUPS = ["Frequently used", "Get started"];

export const withCardSettingsCommand = (
  commandGroups: CommandGroup[],
  context: IAllCommands["context"] | null,
): CommandGroup[] => {
  if (context === null) return commandGroups;
  const boardSettings = commandGroups
    .filter((group) => !CARD_SETTINGS_SHORTCUT_GROUPS.includes(group.group))
    .flatMap((group) => group.commandLists)
    .find((command) => command.key === "boardSettings");
  if (!boardSettings) return commandGroups;
  const pair = [boardSettings, CARD_SETTINGS_COMMAND];
  if (context === "Kanban" && commandGroups.some((group) => group.group === "Board")) {
    return commandGroups.map((group) => ({
      ...group,
      commandLists:
        group.group === "Board"
          ? [...pair, ...group.commandLists]
          : group.commandLists.filter((command) => command !== boardSettings),
    }));
  }
  return commandGroups.map((group) => ({
    ...group,
    commandLists: group.commandLists.flatMap((command) => (command === boardSettings ? pair : [command])),
  }));
};
