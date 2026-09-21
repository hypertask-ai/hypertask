
import UpdateKanban from '@/hooks/MultiPages/useUpdateTaskInBoards';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useRecoilState } from '@/lib/state';
import { currentProjectAtom } from '@/store';
import { useCustomAiInstructions } from '@/lib/contexts/Multipages/customAiInstructionContext';
import { FC } from 'react';

const customInstructionsActionButtonClass =
  "inline-block rounded-[4px] px-6 py-2.5 font-medium leading-normal text-white-black transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-light-gray";

const ActionRow = () => {
    
    const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom)
    const { value, loading, setLoading } = useCustomAiInstructions()
    const { updateProject, getProjectIdxAndAllData, allDataExists } = UpdateKanban()


    const confirmHandler = async () => {
        if (!_currentProject || loading) return toast("Please wait while the previous action finishes!")

        try {
            setLoading(true)
            const { allData, projectToUpdateIndex } = getProjectIdxAndAllData(_currentProject.id)
            const res = await axios.post("/api/ai/project/customInstruction", {
                projectId: _currentProject?.id,
                customInstruction: value,
            })
            console.log("🚀 ~ confirmHandler ~ res:", res)
            if (res.status === 200) {
                setCurrentProject((prev) => ({ ...prev!, ai_custom_instructions: [res.data] }))
                toast.success("Custom instructions updated")
                if (!allDataExists) return;
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
};

const ActionButton: FC<ActionButtonProps> = ({
  onClick,
  disabled = false,
}) => {
  return (
    <button
      className={customInstructionsActionButtonClass}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      Save instructions
    </button>
  );
};

export default ActionRow
