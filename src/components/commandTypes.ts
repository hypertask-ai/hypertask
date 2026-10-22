import { IAllCommands } from "@/models/model";



export interface CommandFocusProxy {
  current: HTMLInputElement | HTMLTextAreaElement | null;
  compose?: boolean;
  pendingEnter?: string;
}

export interface IHTCProps {
  callbackHandler?: (payload: any, mode: string) => void | Promise<void>;
  contextOptions?: IAllCommands;
  focusProxy?: CommandFocusProxy;
}
