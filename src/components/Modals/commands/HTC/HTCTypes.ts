import { CommandMode } from "@/models/enums";
import { RefObject } from "react";

export interface CommandListProps {
    groupIndex:number;
    commandLists: ICommandList[];
    selectedCommand: ICommandList | null;
    handleMouseLeave: () => void;
    handleMouseEnter: (index: number, groupIndex:number) => void;
    commandRef: RefObject<HTMLDivElement | null>;
    onClickHandler:any
    isMobile?: boolean;

}


export interface ICommandList {
    frequency?: number;
    lastUsedAt?: number;
    key: string;
    name: string;
    payload?: string;
    commandMode: CommandMode; // Assuming CommandMode is a predefined type or enum
    checkOwnerShip?: boolean; // This property is optional
    keyboard?:(string | null)[]
    /** Optional synonyms/keywords for Cmd+K search discoverability */
    keywords?: string;
    isNew?: boolean;
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
    handleMouseEnter: (index: number, groupIndex:number) => void;
    commandRef: RefObject<HTMLDivElement | null>;
    onClickHandler:any
    isMobile?: boolean;
}
