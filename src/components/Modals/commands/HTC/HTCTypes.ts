import { CommandMode } from "@/models/enums";
import { RefObject } from "react";

export interface CommandListProps {
    groupIndex:number;
    commandLists: ICommandList[];
    selectedCommand: ICommandList | null;
    handleMouseLeave: () => void;
    handleMouseEnter: (command: ICommandList, index: number, groupIndex:number) => void;
    commandRef: RefObject<HTMLDivElement | null>;
    onClickHandler:any
    isMobile?: boolean;
    inline?: boolean;

}


export interface ICommandList {
    frequency?: number;
    lastUsedAt?: number;
    key: string;
    name: string;
    payload?: string;
    commandMode: CommandMode;
    checkOwnerShip?: boolean;
    keyboard?:(string | null)[]
    keywords?: string;
    isNew?: boolean;
    isRunning?: boolean;
   }
export interface CommandGroup{
    group:string;
    commandLists:ICommandList[]
}

export interface CommandGroupsProps {
    filterCommands: CommandGroup[]|null;
    selectedCommand: ICommandList | null;
    handleMouseMove:()=>void
    handleMouseLeave: () => void;
    handleMouseEnter: (command: ICommandList, index: number, groupIndex:number) => void;
    commandRef: RefObject<HTMLDivElement | null>;
    onClickHandler:any
    isMobile?: boolean;
}
