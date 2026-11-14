import type { KeyboardEvent } from "react";
import type { ICommandList } from "./HTCTypes";

export const commitPaletteSearchEnter = (
  event: KeyboardEvent,
  command: ICommandList | null,
  commit: (command: ICommandList) => void,
) => {
  if (event.key !== "Enter" || !command) return false;
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
  commit(command);
  return true;
};
