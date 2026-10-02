import { IAllCommands } from "@/models/model";



export interface IHTCProps {
  callbackHandler?: (payload: any, mode: string) => void | Promise<void>;
  contextOptions?: IAllCommands;
}
