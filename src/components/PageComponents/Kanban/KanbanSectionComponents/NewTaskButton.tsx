import Tooltip from '@/components/Common/Tooltip';
import { useFlag } from '@/hooks/useFlag';
import { TDefaultEditFocus, TSectionPayload } from '@/models/CreateTaskModalModels/model';
import React, { useState } from 'react'
import { DroppableStateSnapshot } from '@hello-pangea/dnd';
import { Plus } from "lucide-react";

type TButtonPosition = "top"|"bottom";
interface INewTaskButton{
    buttonPosition:TButtonPosition
    createTaskAt: (
        position: TButtonPosition,
        sectionPayload?: TSectionPayload,
        defaultEditFocus?: TDefaultEditFocus,
        useQuickEntry?: boolean,
    ) => void;
    snapshot?: DroppableStateSnapshot;
    sectionPayload:TSectionPayload
}

const NewTaskButton:React.FC<INewTaskButton> = ({buttonPosition, createTaskAt, snapshot, sectionPayload}) => {
    const quickEntryCardsEnabled = useFlag("htpr-6175-quick-entry-cards");
    let quickEntryRequested: true | undefined;
    if (quickEntryCardsEnabled) quickEntryRequested = true;
    
    // ============= for top of section on section title. 
    if (buttonPosition == "top"){
        const  left= -160;
        const bottom = -15
        return(
            <div     
                onClick={()=>createTaskAt("top", sectionPayload, undefined, quickEntryRequested)}
                className="
                group create-new-task-button
                scale-100  relative group-hover/main:scale-100 cursor-pointer">
                <TooltipAndIcon text='Create task at top' keyCombination={["C"]} left={left} bottom={bottom}/>
            </div>
        )
    }

    // =============== for bottom of section
    else if (buttonPosition ==="bottom" && !snapshot?.isDraggingOver){
        return (
            <div 
            onClick={()=>createTaskAt("bottom", sectionPayload, undefined, quickEntryRequested)}
            className="
                group
                scale-100 sm:scale-0 hover:bg-opacity-70 cursor-pointer  bg-opacity-20  
                group-hover/main:scale-100 w-full mt-[16px] bg-slate-500 py-2 
                rounded flex justify-center"
                >
                <TooltipAndIcon text='Create task' keyCombination={["C"]} left={20} bottom={-40}/>
            </div>
        )
    }
    else return(<></>)
}

const TooltipAndIcon = (
    {
        text, keyCombination, left, bottom
    }:{
        text:string,keyCombination:string[], left:number, bottom:number
    })=>{
    return (
        <>
        <Plus size={10} className='sm:mx-0 xs:mx-2  text-white-black' strokeWidth={1.75}/>
             <Tooltip
                    left={left}
                    bottom={bottom}
                    text={text}
                    keyCombination={keyCombination}
                    shouldReAdjustToViewport={false}
                />
        </>

    )
}

export default NewTaskButton
