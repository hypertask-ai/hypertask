import styles from '@/styles/tiptap.module.scss'
import dynamic from "next/dynamic";
import { currentUserAtom } from '@/store';
import { useRecoilState } from '@/lib/state';
import { useContext, useEffect, useMemo, useState } from 'react';
import { MobileViewContext } from '@/lib/contexts/mobileContext';
import { SmilePlus } from "lucide-react";
import { LazyEmojiPicker, preloadEmojiResources } from "@/utils/emojiLoader";

import { useDescriptionAndCommentsContext } from '@/lib/contexts/TaskDetail/DescriptionProvider';
import { useTaskContext } from '@/lib/contexts/TaskDetail/TaskProvider';
import DescriptionEmojiComponent from './DescriptionEmojiComponent';
import { ITask } from '@/models/model';
import DescriptionEmojiButton from '../TopRow/DescriptionEmojiButton';
import { debounce } from '@/utils/helperFunctions/helperFunctions';
import Tooltip from '@/components/Common/Tooltip';
import { cn } from '@/utils/undoActions/helperFuncs';
import { taskDetailSpacing } from '@/lib/configs/taskDetail.config';
const DescriptionReactions = ()=>{
    
    const {toggleEmojiPickerDescription, showEmojiPickerDescription, emojiClickHandlerDescriptionr, handleClickOutside, emojiFinder}= useDescriptionAndCommentsContext()
    const{currentTask, parsedTask:parsed_task, editMode} = useTaskContext()
    const _parsedTask:ITask = useMemo(()=>JSON.parse(parsed_task),[parsed_task])

    const _mbl = useContext(MobileViewContext);

    const [currentUser,_setCurrentUser] = useRecoilState(currentUserAtom);


    const [showHere, setShowHere] = useState<boolean>(false)
    const localClickOutside = (event: any) => {
        setShowHere(false)
        handleClickOutside(event)
    }
// ============================== MOBILE
    if (_mbl && editMode!=="description"){
        return (
            <div
            className={cn("flex asd items-center gap-1 flex-wrap", styles.unstacked_grid_row3, taskDetailSpacing.mobile.descriptionContainer)}>
            {
            currentTask?.description_?.reactions?.map((reaction,index)=>
                <>
                <DescriptionEmojiComponent
                    descriptionId={_parsedTask?.description_.id}
                    currentUser={currentUser}
                    initialCount={reaction.count}
                    reaction={reaction}
                    emojiClickHandler={debounce(emojiClickHandlerDescriptionr,10)}
                    emojiFinder={emojiFinder}
                    />
                </>
            
                // eslint-disable-next-line react/jsx-key
            )}
            
                <DescriptionEmojiButton 
                    showEmojiPickerDescription={showEmojiPickerDescription}
                    handleClickOutside={handleClickOutside}
                    emojiClickHandler={emojiClickHandlerDescriptionr}
                    toggleEmojiPicker={toggleEmojiPickerDescription}
                    
                    />
            
                
            </div>
        )
    }

// ============================ DESKTOP 
    else return (
        <div
            className={`flex items-baseline gap-1 mr-1 mt-3`}>
             {
            currentTask?.description_?.reactions?.map((reaction,index)=>
                <>
                <DescriptionEmojiComponent
                    descriptionId={currentTask?.description_.id}
                    currentUser={currentUser}
                    initialCount={reaction.count}
                    reaction={reaction}
                    emojiClickHandler={debounce(emojiClickHandlerDescriptionr,10)}
                    emojiFinder={emojiFinder}
                    />
                </>
            
                // eslint-disable-next-line react/jsx-key
            )}
            {
                currentTask?.description_?.reactions&&currentTask?.description_?.reactions.length>0&&
                    <div className="relative  group flex">

                    <SmilePlus size={14}
                        className="cursor-pointer text-white-black  ml-1 rounded-lg  "
                        onClick={()=>setShowHere(prev=>!prev)}
                         strokeWidth={1.75}/>
                        {showHere &&
                        <div className={`${styles.unstacked_grid_row4}`}>

                            <div className="absolute top-full bottom-auto left-[-10%] z-40">
                                <LazyEmojiPicker 
                                    onClickOutside={localClickOutside}
                                    perLine={7}
                                    showPreview={false}
                                    previewPosition={"none"}
                                    emojiSize={14}
                                    enableFrequentEmojiSort={true}
                                    showCloseButton={false}
                                    autoFocus={true}
                                    onEmojiSelect={debounce(emojiClickHandlerDescriptionr,10)} />
                            </div>
                        </div>} 

                        <Tooltip
                            left={0}
                            bottom={-40}
                            keyCombination={["R"]}
                            text={"Add Reaction"}
                        />
                    </div>
            }
                
            
            </div>
    )
}


export default DescriptionReactions
