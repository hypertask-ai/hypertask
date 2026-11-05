
import UpdateKanban from '@/hooks/MultiPages/useUpdateTaskInBoards';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useRecoilState } from '@/lib/state';
import { currentProjectAtom } from '@/store';
import { useCustomAiInstructions } from '@/lib/contexts/Multipages/customAiInstructionContext';
import { FC, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const customInstructionsActionButtonClass =
  "inline-block rounded-[4px] px-6 py-2.5 font-medium leading-normal transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray";

const ActionRow = () => {
    
    const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom)
    const { value, loading, setLoading } = useCustomAiInstructions()
    const queryClient = useQueryClient()
    const { updateProject, getProjectIdxAndAllData } = UpdateKanban()


    const confirmHandler = async () => {
        if (!_currentProject || loading) return toast("Please wait while the previous action finishes!")

        try {
            setLoading(true)
            const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(_currentProject.id)
            const res = await axios.post("/api/ai/project/customInstruction", {
                projectId: _currentProject?.id,
                customInstruction: value,
            })
            if (res.status === 200) {
                queryClient.setQueryData(["board-ai-custom-instructions", _currentProject.id], res.data)
                setCurrentProject((prev) => prev?.id === _currentProject.id
                    ? { ...prev, ai_custom_instructions: [res.data] }
                    : prev)
                toast.success("Custom instructions updated")
                updateProject(projectToUpdateIndex, allData, { ai_custom_instructions: res.data })
            }
        } catch (error) {
            console.log("🚀 ~ confirmHandler ~ error:", error)
            toast.error("Unable to update custom instructions")

        } finally {
            setLoading(false)
        }

    }

    return (
        <footer className="flex self-end px-2 py-2">
            <ActionButton disabled={loading} onClick={confirmHandler} />
        </footer>
    )
}




type ActionButtonProps = {
  onClick: () => any;
  disabled?: boolean;
  children?: ReactNode;
  secondary?: boolean;
};

export const ActionButton: FC<ActionButtonProps> = ({
  onClick,
  disabled = false,
  children = "Save instructions",
  secondary = false,
}) => {
  return (
    <button
      className={`${customInstructionsActionButtonClass} ${secondary ? "text-text-light-gray hover:text-white-black focus-visible:text-white-black" : "text-white-black"}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
};

export default ActionRow
