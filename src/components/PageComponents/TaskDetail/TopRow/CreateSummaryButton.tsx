import useCurrentUser from '@/hooks/General/useCurrentUserCheckFromCookies';
import { useTaskContext } from '@/lib/contexts/TaskDetail/TaskProvider';
import React from 'react'
import { Sparkles } from "lucide-react";

const CreateSummaryButton = () => {
    const { setEditMode, currentTask, comments } = useTaskContext();
    const triggerDescriptionAiEditMode = (targetId: string, prompt: string) => {
        setEditMode('description-ai')
        setTimeout(() => {
            triggerAITaskWriter(targetId, prompt);
        }, 100); 
    }

    if (currentTask?.description_?.flaggedIncomplete || comments.length < 1) {
        return <></>
    }
    return (
        // {/* Variation 2: Purple Accent */}
          <div className="space-y-3 mb-2 group transition-colors duration-150">
            <button  
                onClick={() => triggerDescriptionAiEditMode('description', "write it full")}
                className="pl-3 py-1 group-hover:text-white-black bg-transparent rounded-sm    flex items-center gap-2">
              <Sparkles className='text-hypertasks-ai-purple' size={12}  strokeWidth={1.75}/>
              AI Description
            </button>
          </div>
        // <div className="flex justify-end mb-2">
        //     <button
        //         onClick={() => triggerDescriptionAiEditMode('description', "write it full")}
        //         className="px-3 py-1 rounded border-[0.25px] border-opacity-35  border-text-light-gray  text-icon-dark-gray text-opacity-70 hover:bg-gray-600 transition-colors text-content font-medium"
        //         style={{ boxShadow: "0 1px 2px 0 rgba(60,60,60,0.03)" }}
        //         type="button"
        //     >
        //         Create description from comments
        //     </button>
        // </div>
    )
}

export default CreateSummaryButton

// utils/aiTaskWriterEvents.ts
export const AI_TASK_WRITER_EVENT = 'ai-task-writer-trigger';

export interface AITaskWriterEventDetail {
    targetId: string;
    prompt: string;
}

export const triggerAITaskWriter = (targetId: string, prompt: string) => {
    const event = new CustomEvent(AI_TASK_WRITER_EVENT, {
        detail: { targetId, prompt }
    });
    window.dispatchEvent(event);
};
