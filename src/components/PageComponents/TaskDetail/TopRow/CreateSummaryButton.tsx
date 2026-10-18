import { useFlag } from "@/hooks/useFlag";
import { HTPR_7337_EDIT_WITH_AI_FLAG } from "@/lib/flags/keys";
import { useCommentToAiChat } from "@/hooks/MultiPages/AIChat/useCommentToAiChat";
import { useTaskContext } from '@/lib/contexts/TaskDetail/TaskProvider';
import React from 'react'
import { Sparkles } from "lucide-react";

const CreateSummaryButton = () => {
    const { setEditMode, currentTask, comments } = useTaskContext();
    const editWithAiEnabled = useFlag(HTPR_7337_EDIT_WITH_AI_FLAG);
    const { editTicketWithAi } = useCommentToAiChat();
    const triggerDescriptionAiEditMode = (targetId: string, prompt: string) => {
        setEditMode('description-ai')
        setTimeout(() => {
            triggerAITaskWriter(targetId, prompt);
        }, 100); 
    }

    if (currentTask?.description_?.flaggedIncomplete || (!editWithAiEnabled && comments.length < 1)) {
        return <></>
    }
    return (
          <div className="space-y-3 mb-2 group transition-colors duration-150">
            <button  
                onClick={() => editWithAiEnabled
                    ? void editTicketWithAi(currentTask!.id)
                    : triggerDescriptionAiEditMode('description', "write it full")}
                className="pl-3 py-1 group-hover:text-white-black bg-transparent rounded-sm    flex items-center gap-2">
              <Sparkles className='text-hypertasks-ai-purple' size={12}  strokeWidth={1.75}/>
              {editWithAiEnabled ? "Edit with AI" : "AI Description"}
            </button>
          </div>
    )
}

export default CreateSummaryButton

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
