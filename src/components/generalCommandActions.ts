import { CommandMode } from "@/models/enums";
import { IAgent, IProject, ISection, IUser } from "@/models/model";
import axios from "axios";
import toast from "react-hot-toast";
import { createTeam } from "@/utils/api/Homepage";
import { markAsUnseen } from "@/utils/api/Inbox";
import { LEARN_TUTORIAL_COLUMN_CREATED_EVENT, type LearnTutorialColumnCreatedDetail } from "@/lib/tutorial/learnTutorialState";
import globalConstants from "@/lib/constants";
import { getActiveColumnsViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { boardRunningTimersQueryKey } from "@/hooks/Task Detail/useTimeTracking";
import { buildBranchName } from "@/utils/branchName";
import { writeTextToClipboard } from "@/lib/utils/clipboard";
import type { useCommandsState } from "./useCommandsState";
import type { createCommandModalCallbacks } from "./commandModalCallbacks";

type Context = Pick<ReturnType<typeof useCommandsState>, "boardCloseHandler" | "inViewObject" | "assignTaskUser" | "currentUser" | "router" | "_currentProject" | "queryClient" | "setCurrentProject" | "goToProjectShortcut" | "_activeItem" | "activeSectionId" | "setBoardColumnsViewAPI" | "getProjectIdxAndAllData" | "updateProjectView" | "renameBoard" | "removeMemberFromBoard" | "addAgentToBoard" | "removeAgentFromBoard" | "inviteNewMembersToBoard" | "setShowCommands" | "setCommandMode"> &
  Pick<ReturnType<typeof createCommandModalCallbacks>, "toggleAssignModal">;

export function createGeneralCommandActions(context: Context) {
  const {
  boardCloseHandler, inViewObject, assignTaskUser, currentUser, toggleAssignModal,
  router, _currentProject, queryClient, setCurrentProject, goToProjectShortcut,
  _activeItem, activeSectionId, setBoardColumnsViewAPI, getProjectIdxAndAllData, updateProjectView,
  renameBoard, removeMemberFromBoard, addAgentToBoard, removeAgentFromBoard, inviteNewMembersToBoard,
  setShowCommands, setCommandMode,
  } = context;


  const subscribeGoogleCalendar = async () => {
    boardCloseHandler();
    try {
      const { data } = await axios.get("/api/calendar/feed-url");
      if (!data?.url) throw new Error("no url");
      await navigator.clipboard?.writeText(data.url);
      window.open(
        `https://calendar.google.com/calendar/u/0/r/settings/addbyurl?cid=${encodeURIComponent(
          data.url
        )}`,
        "_blank"
      );
      toast.success(
        "Feed URL copied — paste it in Google Calendar if it isn't prefilled"
      );
    } catch {
      toast.error("Could not generate your calendar feed URL");
    }
  };

  const copyCurrentPageURL = async () => {
    try {
      const copied = await writeTextToClipboard(window.location.href);
      if (copied) toast.success("Current page URL copied");
      else toast.error("Unable to copy current page URL");
    } finally {
      boardCloseHandler();
    }
  };

  const copyBranchNameHandler = async () => {
    const ticketNumber = inViewObject.taskTicketNumber;
    const title = inViewObject.taskTitle;

    if (!ticketNumber || !title) {
      boardCloseHandler();
      return;
    }

    try {
      await navigator.clipboard.writeText(buildBranchName(ticketNumber, title));
      toast.success("Branch name copied");
    } catch {
      toast.error("Unable to copy branch name");
    } finally {
      boardCloseHandler();
    }
  };

  const assignToMeHandler = async () => {
    if (!inViewObject.taskId) return boardCloseHandler();

    try {
      const updatedAssignees = await assignTaskUser(
        currentUser,
        inViewObject.taskId,
        "assign"
      );
      toggleAssignModal(updatedAssignees);
    } catch {
      toast.error("Unable to assign this task");
      boardCloseHandler();
    }
  };

  const GoToHandler = (href: string, shouldNewTab?: boolean) => {
    boardCloseHandler();
    shouldNewTab ? window.open(href, "_blank") : router.push(href);
  };

  // Replay the onboarding sequence on demand. Carry the current board so the
  // connect-AI / tutorial / launch steps land back on it when finished.
  const GoToOnboarding = () => {
    boardCloseHandler();
    router.push(
      `/onboarding?projectId=${_currentProject?.id}&teamTitle=${encodeURIComponent(
        _currentProject?.team?.title ?? ""
      )}&id=${_currentProject?.teamId}`
    );
  };

  const deleteAllChats = async () => {
    const response = await axios.delete(
      "/api/ai-chat/delete-session?delete=ALL"
    );
    if (response.status === 200) {
      toast.success("All chat sessions deleted successfully");
    } else {
      toast.error("Failed to delete all chat sessions");
    }
    queryClient.invalidateQueries({
      queryKey: ["chat-sessions", currentUser?.uid],
    });
    boardCloseHandler();
  };

  const toggleBoardTimeTrackingHandler = async () => {
    if (!_currentProject?.id) {
      boardCloseHandler();
      return;
    }

    const enabled = !_currentProject.timeTrackingEnabled;
    try {
      const { data } = await axios.post("/api/projects/time-tracking", {
        projectId: _currentProject.id,
        enabled,
      });
      const newState = data.enabled as boolean;
      setCurrentProject({ ..._currentProject, timeTrackingEnabled: newState });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: boardRunningTimersQueryKey(_currentProject.id),
        }),
        queryClient.invalidateQueries({ queryKey: ["projectsAll"] }),
      ]);
      toast.success(
        newState
          ? "Time tracking on for this board"
          : "Time tracking off for this board"
      );
    } catch (error: any) {
      toast.error(
        error?.response?.data?.error ?? "Unable to update time tracking"
      );
    } finally {
      boardCloseHandler();
    }
  };

  const createBoard = async (
    mode: string,
    title: string,
    teamId: string | null,
    googleAccountId: string | null,
    teamTitle?: string
  ) => {
    if (!_currentProject) return;
    // The create route rejects with a reason the user needs to see (e.g. the free
    // board limit); without this the rejection was silent and the modal just hung.
    try {
      if (mode === "CreateTeamBoard" && teamTitle) {
        const body = {
          userId: currentUser?.id,
          teamTitle: teamTitle,
        };
        const response = await createTeam(body);
        const { data } = await axios.post("/api/projects/create", {
          userId: currentUser?.id,
          title,
          googleAccountId: response.data.googleAccountId,
          teamId: response.data.id,

        });
        receieveResponse(data, "Team");
      } else {
        const { data } = await axios.post("/api/projects/create", {
          userId: currentUser?.id,
          title,
          googleAccountId: googleAccountId,
          teamId: teamId,

        });
        receieveResponse(data, "Board");
      }
    } catch (error: any) {
      toast.error(
        error?.response?.data?.message ?? "Unable to create board"
      );
      boardCloseHandler();
    }
  };
  // =========== create board and update cache
  const receieveResponse = async (data: any, type: "Team" | "Board") => {
    if (data) {
      setCurrentProject(data);
    }
    router.refresh();
    await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    await queryClient.refetchQueries({ queryKey: ["getAllTeamsMinimal"] });
    await queryClient.refetchQueries({ queryKey: ["getAllFavorites"] });
    goToProjectShortcut(data.id, true);
    boardCloseHandler();
  };

  const redirectToTrash = () => {
    if (!_currentProject) return;
    router.push(`/trash/${_currentProject.id}`);
  };

  // ================ mark as unread function.
  const markUnread = async () => {
    if (_activeItem) {
      await markAsUnseen(inViewObject.taskId, false, "byTaskId");
      await queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      queryClient.refetchQueries({ queryKey: ["inbox"] });
      toast("Marked as Unread");
      boardCloseHandler();
    }
  };

  const hideActiveColumn = async () => {
    const currentProject = _currentProject as IProject | null;
    if (!currentProject) return;

    const sections = getActiveColumnsViewFromProject(currentProject);
    const section = sections.find((section) => section.id === activeSectionId);
    if (!section || !section.visibility) return;

    const sendUpdateSection = {
      ...section,
      visibility: false,
    };
    const updatedSections = sections.map((section) =>
      section.id === sendUpdateSection.id
        ? { ...section, ...sendUpdateSection }
        : section
    );

    queryClient.setQueryData(
      [
        globalConstants.GetAllManageColumnsPrefixKey,
        currentProject.id,
        currentUser.id,
      ],
      updatedSections
    );
    setBoardColumnsViewAPI(currentProject, updatedSections);
  };

  const createColumn = async (title: string, ranking: string | undefined) => {
    if (!_currentProject) return;

    // HTPR-5527: axios rejects on 4xx/5xx, so an unguarded call left the dialog
    // open forever with no message when the create failed.
    let response;
    try {
      response = await axios.post("/api/section/create", {
        projectId: _currentProject.id,
        title,
        ranking,
      });
    } catch (error) {
      console.log("🤔 ~ createColumn ~ error:", error);
      toast.error("Error creating column");
      boardCloseHandler();
      return;
    }

    let createdSectionForReveal: ISection | undefined;
    if (response.status === 200) {
      try {
        const createdSection = response.data?.section;
        if (
          Number.isSafeInteger(createdSection?.id) &&
          Number.isSafeInteger(createdSection?.projectId) &&
          typeof createdSection?.section_title === "string"
        ) {
          window.dispatchEvent(
            new CustomEvent<LearnTutorialColumnCreatedDetail>(
              LEARN_TUTORIAL_COLUMN_CREATED_EVENT,
              {
                detail: {
                  columnId: createdSection.id,
                  projectId: createdSection.projectId,
                  title: createdSection.section_title,
                },
              }
            )
          );
        }
        toast.success(`Column ${title} created successfully`);
        const { projectToUpdateIndex } = getProjectIdxAndAllData(
          _currentProject?.id
        );
        // HTPR-5542: pass the created section, not just the refreshed view. A
        // board that has never saved a view has no Project_View row, so the
        // route answers project_view: null and a view-only update was skipped —
        // the column existed in the database but never reached the board.
        createdSectionForReveal = Number.isSafeInteger(createdSection?.id)
          ? { ...createdSection, items: [] }
          : undefined;
        updateProjectView(
          projectToUpdateIndex,
          response.data.project_view,
          Number.isSafeInteger(createdSection?.id)
            ? { ...createdSection, items: [] }
            : undefined
        );
      } catch (error: any) {
        console.log("🤔 ~ createColumn ~ error:", error);
      }
    } else toast.error("Error creating column");
    boardCloseHandler();
    return createdSectionForReveal;
  };

  const updateBoard = async (title: string) => {
    if (!_currentProject) return;

    setCurrentProject({ ..._currentProject, title });
    renameBoard(title, _currentProject.id);
    boardCloseHandler();

    await axios.post("/api/projects/update", {
      projectId: _currentProject.id,
      title,
      sorting_mode: _currentProject.sorting_mode,
    });
  };

  const removeMemberLocal = async (member: IUser) => {
    if (!_currentProject) return;
    await removeMemberFromBoard(member, _currentProject);
    boardCloseHandler();
  };

  const addAgentToBoardLocal = async (agent: IAgent) => {
    if (!_currentProject) return;
    await addAgentToBoard(agent, _currentProject);
    boardCloseHandler();
  };

  const removeAgentFromBoardLocal = async (agent: IAgent) => {
    if (!_currentProject) return;
    await removeAgentFromBoard(agent, _currentProject);
    boardCloseHandler();
  };

  //  ----------------------------INVITE NEW MEMBER
  const inviteNewMemberHandlerLocal = async (emails: string[]) => {
    if (!_currentProject) return;
    await inviteNewMembersToBoard(emails, _currentProject, currentUser);
    boardCloseHandler();
  };

  function toggleManageColumns(add: boolean = false) {
    if (add) {
      setShowCommands({ show: true, mode: CommandMode.AddColumn });
      setCommandMode(CommandMode.AddColumn);
      return;
    }
    boardCloseHandler();
  }
  return {
  subscribeGoogleCalendar, copyCurrentPageURL, copyBranchNameHandler, assignToMeHandler, GoToHandler,
  GoToOnboarding, deleteAllChats, toggleBoardTimeTrackingHandler, createBoard, redirectToTrash,
  markUnread, hideActiveColumn, createColumn, updateBoard, removeMemberLocal,
  addAgentToBoardLocal, removeAgentFromBoardLocal, inviteNewMemberHandlerLocal, toggleManageColumns,
  };
}
