import type { TaskDetailContext } from "./TaskDetailContext";
export type TaskDetailKeyboardContext = TaskDetailContext & {
  handleKeyUp: (event: KeyboardEvent) => void;
  handleKeyDown: (event: KeyboardEvent) => unknown;
};

export interface TaskDetailCommand {
  action: string;
  matches: () => boolean;
  run: () => { stop: true; value?: unknown } | undefined;
}
