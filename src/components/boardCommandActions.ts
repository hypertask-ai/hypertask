import { setTableStalenessColumns } from "@/store";
import { IProject, IProjectsAll, ISection } from "@/models/model";
import axios from "axios";
import toast from "react-hot-toast";
import { setRecurrenceApiHandler } from "@/utils/api/Task Detail";
import type { PickerOption } from "./Modals/OptionPicker";
import { getActiveSortingStackFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { getActiveStalenessFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { getAcceptDestination } from "@/utils/triageDestination";
import { openTaskTemplateDraft } from "@/lib/taskTemplatePrefill";
import type { IHTCProps } from "./commandTypes";
import type { useCommandsState } from "./useCommandsState";

type Context = Pick<IHTCProps, "callbackHandler"> &
  Pick<ReturnType<typeof useCommandsState>, "boardCloseHandler" | "inViewObject" | "queryClient" | "taskTemplatePickerForCurrentProject" | "toggleCreateTaskGlobally" | "_currentProject" | "router" | "setCurrentProject" | "saveStalenessToViewAPI" | "boardLayout" | "setTableVisibleColumns" | "setBoardSortingViewAndReturn" | "removeFromListWithStatus" | "setActiveItem" | "moveItem">;

export function createBoardCommandActions(context: Context) {
  const {
  boardCloseHandler, inViewObject, queryClient, taskTemplatePickerForCurrentProject, toggleCreateTaskGlobally,
  _currentProject, router, setCurrentProject, saveStalenessToViewAPI, boardLayout,
  setTableVisibleColumns, setBoardSortingViewAndReturn, callbackHandler, removeFromListWithStatus, setActiveItem,
  moveItem,
  } = context;


  const setRecurrenceHandler = async (option: PickerOption) => {
    boardCloseHandler();
    if (!inViewObject.taskId) return;
    const rule = option.id === null ? null : String(option.id);
    try {
      await setRecurrenceApiHandler(rule, inViewObject.taskId);
      queryClient.invalidateQueries({ queryKey: ["task-", inViewObject.taskId] });
      toast.success(rule ? `Repeats ${option.label.toLowerCase()}` : "Repeat off");
    } catch {
      toast.error("Could not update the repeat rule");
    }
  };

  const saveTaskTemplateHandler = async () => {
    boardCloseHandler();
    if (!inViewObject.taskId) return;
    try {
      await axios.post("/api/task-templates", { taskId: inViewObject.taskId });
      toast.success("Saved as template");
    } catch {
      toast.error("Could not save the template");
    }
  };

  const openTaskTemplateHandler = (option: PickerOption) => {
    const opened = openTaskTemplateDraft(
      option.id,
      taskTemplatePickerForCurrentProject.templates,
      taskTemplatePickerForCurrentProject.context,
      (duplicate) =>
        toggleCreateTaskGlobally(undefined, undefined, duplicate),
    );
    if (!opened) {
      toast.error("Could not find an open column for this task");
      boardCloseHandler();
      return;
    }

    boardCloseHandler();
  };

  const generateStatusUpdateHandler = async () => {
    boardCloseHandler();
    if (!_currentProject?.id) return;
    const pending = toast.loading("Writing the status update…");
    try {
      const { data } = await axios.post("/api/reports/status-update", {
        projectId: _currentProject.id,
      });
      toast.dismiss(pending);
      toast.success("Status update ready");
      if (data?.url) router.push(data.url);
    } catch (error: any) {
      toast.dismiss(pending);
      toast.error(
        error?.response?.data?.error ?? "Could not generate the status update"
      );
    }
  };

  const toggleStalenessHandler = async () => {
    if (!_currentProject) return boardCloseHandler();

    const enabled = !_currentProject.stalenessEnabled;
    const updateProject = (project: IProject) =>
      project.id === _currentProject.id
        ? { ...project, stalenessEnabled: enabled }
        : project;

    try {
      await axios.post("/api/projects/staleness", {
        projectId: _currentProject.id,
        enabled,
      });
      setCurrentProject(updateProject(_currentProject));
      queryClient.setQueryData<IProjectsAll>(["projectsAll"], (current) =>
        current
          ? { ...current, updatedProjects: current.updatedProjects.map(updateProject) }
          : current
      );
      queryClient.setQueryData<IProject[]>(["projectsAllMinimal"], (current) =>
        current?.map(updateProject)
      );
      toast.success(`Staleness turned ${enabled ? "on" : "off"}`);
    } catch {
      toast.error("Unable to update staleness");
    } finally {
      boardCloseHandler();
    }
  };

  const toggleAutoArchiveHandler = async () => {
    if (!_currentProject) return boardCloseHandler();

    const enabled = _currentProject.autoArchiveAfterDays == null;
    const updateProject = (project: IProject) =>
      project.id === _currentProject.id
        ? { ...project, autoArchiveAfterDays: enabled ? 180 : null }
        : project;

    try {
      await axios.post("/api/projects/auto-archive", {
        projectId: _currentProject.id,
        enabled,
      });
      setCurrentProject(updateProject(_currentProject));
      queryClient.setQueryData<IProjectsAll>(["projectsAll"], (current) =>
        current
          ? { ...current, updatedProjects: current.updatedProjects.map(updateProject) }
          : current
      );
      queryClient.setQueryData<IProject[]>(["projectsAllMinimal"], (current) =>
        current?.map(updateProject)
      );
      toast.success(
        enabled
          ? "Auto-archive on: tasks idle for 6 months get archived"
          : "Auto-archive turned off"
      );
    } catch {
      toast.error("Unable to update auto-archive");
    } finally {
      boardCloseHandler();
    }
  };

  const updateAutoAssignHandler = async (
    sectionId: number,
    {
      autoAssignUserId,
      autoAssignAgentId,
    }: {
      autoAssignUserId: number | null;
      autoAssignAgentId: string | null;
    },
  ) => {
    if (!_currentProject) return boardCloseHandler();

    const updateSections = (sections?: ISection[]) =>
      sections?.map((section) =>
        (section.id ?? section.sectionId) === sectionId
          ? { ...section, autoAssignUserId, autoAssignAgentId }
          : section
      );
    const updateProject = (project: IProject) =>
      project.id === _currentProject.id
        ? {
            ...project,
            section: updateSections(project.section),
            sections: updateSections(project.sections) ?? project.sections,
            filteredSections:
              updateSections(project.filteredSections) ?? project.filteredSections,
          }
        : project;

    try {
      await axios.post("/api/sections/auto-assign", {
        sectionId,
        autoAssignUserId,
        autoAssignAgentId,
      });
      setCurrentProject(updateProject(_currentProject));
      queryClient.setQueryData<IProjectsAll>(["projectsAll"], (current) =>
        current
          ? { ...current, updatedProjects: current.updatedProjects.map(updateProject) }
          : current
      );
      queryClient.setQueryData<IProject[]>(["projectsAllMinimal"], (current) =>
        current?.map(updateProject)
      );
      toast.success(
        autoAssignUserId == null && autoAssignAgentId == null
          ? "Column auto-assign cleared"
          : "Column auto-assign updated"
      );
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ?? "Unable to update column auto-assign"
      );
    } finally {
      boardCloseHandler();
    }
  };

  const toggleStalenessViewHandler = async () => {
    if (!_currentProject) return boardCloseHandler();

    const next = !getActiveStalenessFromProject(_currentProject);
    try {
      // Persist into the active saved view so it survives navigation. When the
      // board has no saved view, the primary view IS the board, so fall back to
      // the board-level setting.
      const persisted = await saveStalenessToViewAPI(_currentProject, next);
      if (persisted === "none") {
        await axios.post("/api/projects/staleness", {
          projectId: _currentProject.id,
          enabled: next,
        });
      }
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      await queryClient.refetchQueries({ queryKey: ["projectsAllMinimal"] });
      if (boardLayout === "table") {
        setTableVisibleColumns((visible) => setTableStalenessColumns(visible, next));
      }
      toast.success(`Staleness ${next ? "shown" : "hidden"} on this view`);
    } catch {
      toast.error("Unable to update staleness for this view");
    } finally {
      boardCloseHandler();
    }
  };

  const sortByStalenessHandler = async (
    mode: "TimeInColumn" | "TimeWithoutComment"
  ) => {
    if (!_currentProject) return boardCloseHandler();

    try {
      // Keep any tie-break levels: this command changes the primary sort, it is not a request to
      // clear the rest of the stack. A duplicate of the new primary is dropped on read.
      await setBoardSortingViewAndReturn(
        _currentProject,
        mode,
        "Descending",
        getActiveSortingStackFromProject(_currentProject)
      );
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      router.refresh();
    } catch {
      toast.error("Unable to sort this board");
    } finally {
      boardCloseHandler();
    }
  };

  const acceptTaskHandler = async () => {
    const taskId = inViewObject.taskId;
    const sourceSectionId = inViewObject.sectionId;

    if (!taskId || !sourceSectionId || !_currentProject) {
      toast.error("Unable to find this task on the board");
      boardCloseHandler();
      return;
    }

    const destinationSection = getAcceptDestination(
      _currentProject.section ?? _currentProject.sections ?? [],
      sourceSectionId
    );
    const destinationSectionId =
      destinationSection?.sectionId ?? destinationSection?.id;

    if (!destinationSection || !destinationSectionId) {
      toast.error("No later column is available for this task");
      boardCloseHandler();
      return;
    }

    try {
      if (callbackHandler) {
        await callbackHandler(destinationSection, "AcceptTask");
      } else {
        await axios.put("/api/tasks/moveTask", {
          projectId: _currentProject.id,
          taskId,
          section_title: destinationSection.section_title,
          sectionId: destinationSectionId,
        });
        // Match the established move pattern: a hidden destination column is
        // synced by removing from the source list, a visible one by moving the
        // item. Accept can land on a hidden column since getAcceptDestination
        // reads the unfiltered section list.
        if (!destinationSection.visibility) {
          await removeFromListWithStatus(
            sourceSectionId,
            inViewObject.taskProjectId ?? _currentProject.id,
            taskId,
            "Move"
          );
          setActiveItem(null);
        } else {
          await moveItem({
            destinationSectionId,
            itemId: taskId,
            sourceSectionId,
          });
        }
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message ?? "Unable to accept task");
    } finally {
      boardCloseHandler();
    }
  };
  return {
  setRecurrenceHandler, saveTaskTemplateHandler, openTaskTemplateHandler, generateStatusUpdateHandler, toggleStalenessHandler,
  toggleAutoArchiveHandler, updateAutoAssignHandler, toggleStalenessViewHandler, sortByStalenessHandler, acceptTaskHandler,
  };
}
