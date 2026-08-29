import { IChatMessage } from "../model"

export interface ChatHeaderProps {
  minimized: boolean
  onMinimize: () => void
  onClose: () => void
}


// types.ts - Shared types
export type TMessage = {
    id: string
    content: string
    role: "human" | "assistant"
    timestamp: Date
  }

export type TSubMessage = {
    event: "status" | "content" | "done"
    data:{
        content:string
    }
}

export interface ChatWindowProps {
    onClose: () => void
}



export interface IMessageItemProps {
  message: IChatMessage;
  copyResponse: (message: IChatMessage) => void;
  createTaskFromResponse: (message: IChatMessage) => void;
  retryStream: (message?: IChatMessage) => void
  editMessage: (message: IChatMessage) => void
}



export interface I_AI_MESSAGE{
    id: string
    content:TSubMessage[]
    role: "human" | "assistant"
    timestamp: Date|number;
    isDelivered:boolean;
}