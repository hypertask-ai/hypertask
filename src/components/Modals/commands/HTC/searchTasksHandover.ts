import { CommandMode } from "@/models/enums";
import type { ICommandList } from "./HTCTypes";

export const getSearchTasksHandover = (
  query: string
): ICommandList | null => {
  if (!query.trim()) return null;

  return {
    key: "searchTasksHandover",
    name: `Search tasks: "${query}"`,
    commandMode: CommandMode.SearchTask,
    payload: query,
  };
};
