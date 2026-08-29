import SearchTasks from "@/components/Modals/commands/searchTasks";
import {
  TaskRelationType,
  useTaskRelations,
} from "@/hooks/Task Detail/useTaskRelations";
import { ITask, TaskRelations } from "@/models/model";
import toast from "react-hot-toast";

type Props = {
  closeHandler: () => void;
  currentTaskId: number;
  header: string;
  onRelationAdded?: (relations: TaskRelations[]) => void | Promise<void>;
  relationType: TaskRelationType;
};

const TaskRelationPicker = ({
  closeHandler,
  currentTaskId,
  header,
  onRelationAdded,
  relationType,
}: Props) => {
  const { addRelations } = useTaskRelations();

  const addRelation = async (task: ITask) => {
    try {
      const response = await addRelations(
        {
          currentTaskId,
          relatedTasks: [
            {
              projectId: task.projectId,
              uniqueIndex: task.uniqueIndex,
            },
          ],
        },
        relationType
      );
      const addedRelations = Array.isArray(response?.data)
        ? response.data
        : [];
      if (addedRelations.length === 0) {
        toast.error("Task relation already exists or cannot be added");
        return;
      }
      await onRelationAdded?.(addedRelations);
      toast.success("Task relation added");
      closeHandler();
    } catch (error: any) {
      toast.error(error?.response?.data?.message ?? "Unable to add task relation");
    }
  };

  return (
    <SearchTasks
      closeHandler={closeHandler}
      currentTaskId={currentTaskId}
      header={header}
      onSelect={addRelation}
    />
  );
};

export default TaskRelationPicker;
