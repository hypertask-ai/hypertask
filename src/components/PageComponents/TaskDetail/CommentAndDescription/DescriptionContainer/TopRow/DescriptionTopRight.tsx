import { useTaskContext } from '@/lib/contexts/TaskDetail/TaskProvider'
import RelativeTime from '@/components/Common/RelativeTime'
import React, {useContext, useState} from 'react'
import dynamic from "next/dynamic";
const DescriptionEmojiButton = dynamic(()=>import("./DescriptionEmojiButton"))

// import DescriptionEmojiButton from './DescriptionEmojiButton'
import { useDescriptionAndCommentsContext } from '@/lib/contexts/TaskDetail/DescriptionProvider'
import { MobileViewContext } from '@/lib/contexts/mobileContext';
import AIWriterButton from '@/components/Common/AIWriterButton';
import TimeTooltip from '@/components/Common/TimeTooltip';

const DescriptionTopRight = () => {
    const {currentTask, editMode} =useTaskContext()
    const [isHovered, setIsHovered] = useState<boolean>(false)
    const date = new Date(currentTask?.createdAt!)
    const isMbl = useContext(MobileViewContext);

    const {toggleEmojiPickerDescription, emojiClickHandlerDescriptionr, showEmojiPickerDescription, handleClickOutside}= useDescriptionAndCommentsContext()
    
    const toggleAiTaskWriter = () => {
        // Trigger the TipTapTaskDetail's toggleAiTaskWriter by clicking the hidden button
        // The button ID is "popover-button-description" based on the divIds pattern
        document.getElementById("popover-button-description")?.click();
    }
  const shouldShowAiWriterButton = isMbl && (editMode === "description" || editMode === "description-ai")
  return (
    <div className='flex gap-1 items-center'>
      {
        !isMbl && 
        <DescriptionEmojiButton 
            showEmojiPickerDescription={showEmojiPickerDescription}
            handleClickOutside={handleClickOutside}
            emojiClickHandler={emojiClickHandlerDescriptionr}
            toggleEmojiPicker={toggleEmojiPickerDescription}
            
            />
      }
      {
        shouldShowAiWriterButton ?
            <AIWriterButton 
                onToggle={toggleAiTaskWriter}
                id="description-task-detail-ai-writer-trigger"
                className={isMbl ? "text-content" : "text-emphasis"}
                tooltipPosition={isMbl ? { left: -80, bottom: -35 } : { left: -40, bottom: -45 }}
            />
            :
          <span className='text-meta text-text-light-gray relative group cursor-default'
          onMouseEnter={() => setIsHovered(true)} // Set isHovered to true on mouse enter
          onMouseLeave={() => setIsHovered(false)} // Set isHovered to false on mouse leave
          >
                  <RelativeTime date={currentTask?.createdAt} />
                  {isHovered && <TimeTooltip time={date} left={55} bottom={-5} />}
          </span>
      }

    </div>
  )
}

export default DescriptionTopRight
