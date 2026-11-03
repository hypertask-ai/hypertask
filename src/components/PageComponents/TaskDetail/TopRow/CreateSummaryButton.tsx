import { HTPR_8173_DESCRIPTION_INLINE_DRAFTS_FLAG } from "@/lib/flags/definitions/htpr-8173-description-inline-drafts";
import { useFlag } from "@/hooks/useFlag";
import { useCommentToAiChat } from "@/hooks/MultiPages/AIChat/useCommentToAiChat";
import { useTaskContext } from '@/lib/contexts/TaskDetail/TaskProvider';
import React from 'react'
import { Sparkles } from "lucide-react";

const CreateSummaryButton = () => {
    const { setEditMode, currentTask } = useTaskContext();
    const descriptionInlineDrafts = useFlag(HTPR_8173_DESCRIPTION_INLINE_DRAFTS_FLAG);
    const { editTicketWithAi } = useCommentToAiChat();

    return (
          <div className="space-y-3 mb-2 group transition-colors duration-150">
            <button  
                onClick={() => {
                    if (descriptionInlineDrafts) {
                        setEditMode('description-ai');
                    } else {
                        void editTicketWithAi(currentTask!.id);
                    }
                }}
                className="pl-3 py-1 group-hover:text-white-black bg-transparent rounded-sm    flex items-center gap-2">
              <Sparkles className='text-hypertasks-ai-purple' size={12}  strokeWidth={1.75}/>
              Edit with AI
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
