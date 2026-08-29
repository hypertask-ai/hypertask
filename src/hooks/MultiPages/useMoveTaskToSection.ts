import { useMutation, useQueryClient } from "@tanstack/react-query";
import { IProjectsAll, ITask } from "@/models/model";
import UpdateKanban from "@/hooks/MultiPages/useUpdateTaskInBoards";
import toast from "react-hot-toast";
import generateRanking from "@/utils/generateRank";

type MoveTaskToSectionInput = {
  projectId: number;
  taskId: number;
  ticketNumber?: string;
  sourceSectionId: number;
  destinationSectionId: number;
  destinationSectionTitle: string;
};

const useMoveTaskToSection = () => {
  const queryClient = useQueryClient();
  const { moveItem } = UpdateKanban();

  const getDestinationEndRanking = (
    projectId: number,
    destinationSectionId: number,
    taskId: number
  ) => {
    const projects = queryClient.getQueryData<IProjectsAll>(["projectsAll"]);
    const destinationItems = projects?.updatedProjects
      ?.find((project) => project.id === projectId)
      ?.sections.find((section) => section.sectionId === destinationSectionId)
      ?.items.filter((task) => task.id !== taskId);
    if (!destinationItems) return undefined;
    return generateRanking(destinationItems[destinationItems.length - 1]?.ranking, undefined);
  };

  return useMutation({
    mutationFn: async ({
      projectId,
      taskId,
      destinationSectionId,
      destinationSectionTitle,
    }: MoveTaskToSectionInput) => {
      const ranking = getDestinationEndRanking(projectId, destinationSectionId, taskId);
      const response = await fetch("/api/tasks/moveTask", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          taskId,
          section_title: destinationSectionTitle,
          sectionId: destinationSectionId,
          section: destinationSectionTitle,
          ranking,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? "Unable to move task");
      return data;
    },
    onMutate: async ({
      taskId,
      sourceSectionId,
      destinationSectionId,
      destinationSectionTitle,
    }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["projectsAll"] }),
        queryClient.cancelQueries({ queryKey: ["task-", taskId] }),
      ]);

      const previousProjects = queryClient.getQueryData<IProjectsAll>(["projectsAll"]);
      const previousTask = queryClient.getQueryData<ITask>(["task-", taskId]);

      queryClient.setQueryData<ITask>(["task-", taskId], (current) =>
        current && !Array.isArray(current)
          ? {
              ...current,
              sectionId: destinationSectionId,
              section: destinationSectionTitle,
            }
          : current
      );
      await moveItem(
        {
          destinationSectionId,
          itemId: taskId,
          sourceSectionId,
        },
        {
          persistRanking: false,
          refetchIfMissing: false,
          showToast: false,
          insertAtEnd: true,
        }
      );

      return { previousProjects, previousTask, taskId };
    },
    onSuccess: (_data, { ticketNumber, destinationSectionTitle }) => {
      toast(`${ticketNumber?.toUpperCase() ?? "Task"} has been moved to ${destinationSectionTitle}`);
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(["projectsAll"], context?.previousProjects);
      queryClient.setQueryData(["task-", context?.taskId], context?.previousTask);
      toast.error(error instanceof Error ? error.message : "Unable to move task");
    },
    onSettled: async (_data, _error, _variables, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projectsAll"] }),
        queryClient.invalidateQueries({ queryKey: ["task-", context?.taskId] }),
      ]);
    },
  });
};

export default useMoveTaskToSection;
