import type { CommandGroup, ICommandList } from "./HTCTypes";

export type CommandIdentity = Pick<ICommandList, "key" | "name">;

export const findCommandPosition = (
  groups: CommandGroup[] | null | undefined,
  identity: CommandIdentity | null | undefined,
  preferredGroupIndex?: number,
) => {
  if (!groups || !identity) return null;

  const findInGroup = (groupIndex: number) => {
    const commandIndex = groups[groupIndex]?.commandLists.findIndex(
      (command) => command.key === identity.key && command.name === identity.name,
    ) ?? -1;
    if (commandIndex < 0) return null;
    return {
      command: groups[groupIndex].commandLists[commandIndex],
      groupIndex,
      commandIndex,
    };
  };

  if (preferredGroupIndex !== undefined) {
    const preferred = findInGroup(preferredGroupIndex);
    if (preferred) return preferred;
  }

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const position = findInGroup(groupIndex);
    if (position) return position;
  }

  return null;
};
