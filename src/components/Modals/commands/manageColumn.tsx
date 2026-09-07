import { IMember, IProject, IProjectsAll, ISection, IUser } from "@/models/model";
import type { IAgent } from "@/models/model";
import { currentProjectAtom, currentUserAtom, showCommandsAtom } from "@/store";
import { ChangeEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
import AssignModal from "@/components/Modals/AssignToUser/AssignToUser";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import { ArrowLeft, Menu, Plus, Settings, Square, SquareCheck, Trash2 } from "lucide-react";



import { ModalBody, ModalFooter, ModalHeader } from "reactstrap";
import { useRecoilState, useRecoilValue } from "@/lib/state";
import { parseCookies } from "nookies";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAllManageColumns } from "@/hooks/MultiPages/useGetAllManageColumns";
import globalConstants from "@/lib/constants";
import {
  DragDropContext,
  Draggable,
  Droppable,
  DropResult,
} from "@hello-pangea/dnd";

import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import axios from "axios";
import toast from "react-hot-toast";
import useKanbanViews from "@/hooks/Homepage/Views/useKanbanViews";
import { getActiveEmptySectionSettingFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { TBoardEmptySections } from "@/models/Views/model";
import {
  applyReorderedSectionsToProject,
  reorderSectionsWithRank,
} from "@/utils/helperFunctions/Views/ColumnReorderHelper";
import ConfirmDialog from "@/components/Modals/Common Modals/ConfirmDialog";
import { isDoneByName } from "@/lib/doneColumns";
import {
  applySectionAutoAssignToProject,
  hasNoSectionAutoAssign,
} from "@/lib/sectionAutoAssign";
import SettingsToggle from "@/components/Modals/Settings/SettingsToggle";
import { getManageColumnRows } from "./manageColumnTaskCounts";
import { MobileViewContext } from "@/lib/contexts/mobileContext";

const ManageColumns = ({ toggleModal }: { toggleModal: (add: boolean) => void }) => {
  const queryClient = useQueryClient();
  const isMobile = useContext(MobileViewContext);
  const [title, setTitle] = useState("");
  const [updating, setUpdating] = useState<boolean>(false);
  const [currentProject, setCurrentProject] = useRecoilState(currentProjectAtom);
  const { setBoardColumnsViewAPI, saveEmptySectionsAPI } =
    useKanbanViews(currentProject);
  const [showEmpty, setShowEmpty] = useState<boolean>(false);
  const [editMode, setEditMode] = useState<boolean>(false);
  const [editSection, setEditSection] = useState<ISection | null>(null);
  const [ticketsFinished, setTicketsFinished] = useState(false);
  const [deleteModal, setDeleteModal] = useState<boolean>(false);
  const [assignOpen, setAssignOpen] = useState<boolean>(false);
  const currentUser = useRecoilValue(currentUserAtom);
  const { data: boardMembers } = useGetAllMembersForAssign(
    ["assign", currentProject?.id],
    // The hook guards on `projectId > 0`, so 0 keeps the query disabled until a
    // project is loaded.
    currentProject?.id ?? 0,
    { members: [], owner: null }
  );
  // Same map the Settings board section builds, so an auto-assigned column shows
  // the person's name rather than their id.
  const membersById = useMemo(() => {
    const boardData = (boardMembers ?? {}) as {
      members?: IMember[];
      owner?: IUser | null;
    };
    const map = new Map<number, IUser>();
    if (boardData.owner) map.set(boardData.owner.id, boardData.owner);
    for (const member of boardData.members ?? []) {
      if (member.user) map.set(member.user.id, member.user);
    }
    return map;
  }, [boardMembers]);
  const agentsById = useMemo(() => {
    const boardData = (boardMembers ?? {}) as { boardAgents?: IAgent[] };
    return new Map(
      (boardData.boardAgents ?? []).map((agent) => [agent.id, agent]),
    );
  }, [boardMembers]);
  const { data: sections } = useGetAllManageColumns(
    currentUser.id,
    currentProject
  );
  const columnRows = useMemo(
    () => getManageColumnRows<ISection>(sections, currentProject?.tasks),
    [currentProject?.tasks, sections],
  );

  const onKeyChange = (e: ChangeEvent<HTMLInputElement>) =>
    setTitle(e.target.value);

  const updateSection = (
    sections: ISection[],
    updatedSection: ISection,
    update: "Delete" | "Others"
  ): ISection[] => {
    const response = sections
      .map((section) => {
        if (section.id === updatedSection.id) {
          if (update === "Delete") return null;
          else return { ...section, ...updatedSection };
        } else return section;
      })
      .filter((section): section is ISection => section !== null); // Type guard

    return response;
  };

  const updateCache = async (newData: any, saveAPI: boolean) => {
    const queryKey = [
      globalConstants.GetAllManageColumnsPrefixKey,
      currentProject?.id,
      currentUser.id,
    ];
    queryClient.setQueryData(queryKey, newData);
    if (currentProject && saveAPI) {
      await setBoardColumnsViewAPI(currentProject, newData);
      // queryClient.refetchQueries({ queryKey: ["projectsAll"] });
    }
  };

  const synchronizeBoardSectionOrder = async (reorderedSections: ISection[]) => {
    if (!currentProject) return;
    // A refetch that started before the ranking write can otherwise resolve
    // after this patch and restore the old order. Stop both board query families
    // before replacing their cached snapshots.
    await Promise.all([
      queryClient.cancelQueries({ queryKey: ["projectsAll"], exact: true }),
      queryClient.cancelQueries({ queryKey: ["projectsAllMinimal"] }),
    ]);
    const updateProject = (project: IProject) =>
      project.id === currentProject.id
        ? applyReorderedSectionsToProject(project, reorderedSections)
        : project;

    setCurrentProject((project) => (project ? updateProject(project) : project));
    queryClient.setQueryData<IProjectsAll>(["projectsAll"], (cached) =>
      cached
        ? {
            ...cached,
            updatedProjects: cached.updatedProjects.map(updateProject),
          }
        : cached
    );
    queryClient.setQueriesData<IProject[]>(
      { queryKey: ["projectsAllMinimal"] },
      (cached) => cached?.map(updateProject)
    );
  };

  // ================= DRAG handler
  const onDragEndHandler = async (result: DropResult) => {
    // dropped outside the list
    if (!result.destination) return;
    try {
      if (result.source.index === result.destination.index) return;
      const { reorderedSections, updatedSection, ranking } =
        reorderSectionsWithRank(
          sections,
          result.source.index,
          result.destination.index
        );
      // Optimistic UI first. The local reorder must never depend on the
      // network round trip succeeding. The view write is held back until the
      // ranking lands, below.
      updateCache(reorderedSections, false);
      // Persist the new ranking on the Section itself. The board orders by
      // Section.ranking on load, so saving only the view cache made the move
      // vanish on every reload (HTPR-3971). The view write follows the ranking
      // rather than preceding it: saving the view first left the two stores
      // disagreeing whenever the ranking write failed, and the board, which
      // reads ranking, snapped the column back (HTPR-5047).
      try {
        // Only the ranking. Sending the full section would trigger the
        // service's section_title branch, which bulk-rewrites every task in
        // the section on each drag.
        await axios.post(`/api/section/update`, {
          userId: currentUser?.id,
          sectionId: updatedSection.id,
          newSection: { ranking },
        });
        // The modal has its own query cache, while the open board renders from
        // currentProject/projectsAll. Patch all three only after the canonical
        // ranking save succeeds so the board moves immediately without reload.
        await synchronizeBoardSectionOrder(reorderedSections);
        await updateCache(reorderedSections, true);
      } catch (persistError) {
        console.log("🚀 ~ onDragEndHandler ~ persist failed:", persistError);
        toast.error("Column order could not be saved");
      }
    } catch (error) {
      console.log("🚀 ~ onDragEndHandler ~ error:", error);
    }
  };

  // ================ toggle show empty sections.
  const handleEmptySections = (setting: TBoardEmptySections) => {
    try {
      setUpdating(true);
      if (currentProject) {
        saveEmptySectionsAPI(currentProject, setting);
      }
    } catch (error) {
      console.log("🚀 ~ handleEmptySections ~ error:", error);
    } finally {
      setUpdating(false);
    }
  };

  // ================ update section's visibility.
  // `overrides` exists because the setting rows save on change. A toggle that
  // calls this straight after setTicketsFinished would still read the previous
  // state, so the caller passes the new value explicitly.
  const handleSectionUpdateVis = async (
    section: ISection,
    saveMode?: string,
    updatedRank?: string,
    overrides?: { section_title?: string; isDone?: boolean }
  ) => {
    try {
      var updatedSections = [...sections];
      if (!section || updating) return;
      setUpdating(true);
      var sendUpdateSection: ISection;

      // BASED ON GIVEN INPUT, SEND REQUEST DATA
      if (saveMode === "DELETE") {
        sendUpdateSection = { ...section, deleted: !section.deleted };
        updatedSections = updateSection(sections, sendUpdateSection, "Delete");
        await axios.post(`/api/section/update`, {
          userId: currentUser?.id,
          sectionId: section.id,
          newSection: sendUpdateSection,
        });
        const queryKey = [
          globalConstants.GetAllManageColumnsPrefixKey,
          currentProject?.id,
          currentUser.id,
        ];
        queryClient.setQueryData(queryKey, updatedSections);
        // if (response.status !== 200) return
        // return cacheUpdateHandler(response)
        return queryClient.refetchQueries({ queryKey: ["projectsAll"] });
      } else if (saveMode === "RENAME") {
        const nextTitle = overrides?.section_title ?? title;
        const nextIsDone = overrides?.isDone ?? ticketsFinished;
        sendUpdateSection = {
          ...section,
          section_title: nextTitle,
          isDone: nextIsDone,
        };
        await axios.post(`/api/section/update`, {
          userId: currentUser?.id,
          sectionId: section.id,
          newSection: {
            section_title: nextTitle,
            isDone: nextIsDone,
          },
        });
      } else {
        sendUpdateSection = { ...section, visibility: !section.visibility };
      }
      updatedSections = updateSection(sections, sendUpdateSection, "Others");
      updateCache(updatedSections, saveMode !== "RENAME");
      if (saveMode === "RENAME" && currentProject) {
        const updateSections = (projectSections?: ISection[]) =>
          projectSections?.map((candidate) =>
            (candidate.id ?? candidate.sectionId) === section.id
              ? { ...candidate, ...sendUpdateSection }
              : candidate
          );
        const updateProject = (project: IProject) =>
          project.id === currentProject.id
            ? {
                ...project,
                section: updateSections(project.section),
                sections: updateSections(project.sections) ?? project.sections,
                filteredSections:
                  updateSections(project.filteredSections) ?? project.filteredSections,
              }
            : project;

        setCurrentProject(updateProject(currentProject));
        queryClient.setQueryData<IProjectsAll>(["projectsAll"], (cached) =>
          cached
            ? {
                ...cached,
                updatedProjects: cached.updatedProjects.map(updateProject),
              }
            : cached
        );
        queryClient.setQueryData<IProject[]>(["projectsAllMinimal"], (cached) =>
          cached?.map(updateProject)
        );
        // Keep the row's own snapshot current. Without this the blur dedupe below
        // compares against the pre-rename title forever and re-posts on every
        // blur, and the assign modal keeps showing the old column name.
        setEditSection((prev) =>
          prev && prev.id === section.id ? { ...prev, ...sendUpdateSection } : prev
        );
        // projectsAll already contains the complete rename patch above. Refetching
        // it makes the board route drop its active payload while the request runs.
        void queryClient.invalidateQueries({ queryKey: ["projectsAllMinimal"] });
      }
    } catch (error) {
      console.log("🚀 ~ handleSectionUpdateVis ~ error:", error);
    } finally {
      setUpdating(false);
    }
  };

  const onSubmit = () => {
    if (title.length === 0) return;
    // Queued for the same reason as the row saves: Enter can land while a blur
    // save is still running.
    void queueSave(() => handleSectionUpdateVis(editSection!, "RENAME"));
    setEditMode((prev) => !prev);
  };

  const toggleEdit = (section: ISection) => {
    setEditMode((prevState) => !prevState);
    setEditSection(section);
  };

  // GO BACK HANDLER
  const goBack = () => {
    setEditMode((prevState) => !prevState);
    setEditSection(null);
  };

  // OPEN EDIT COLUMN VIEW
  const openEditView = (section: ISection) => {
    toggleEdit(section);
    setTitle(section.section_title);
    setTicketsFinished(
      section.isDone ?? isDoneByName(section.section_title)
    );
  };

  // Desktop rows save as they change. Mobile keeps the original explicit Save
  // action for the name field. Setting rows can still fire together, so queue
  // them rather than letting the `updating` guard drop the second request.
  const savesRef = useRef<Promise<unknown>>(Promise.resolve());
  const queueSave = (run: () => Promise<unknown>) => {
    savesRef.current = savesRef.current.then(run, run);
    return savesRef.current;
  };

  const saveIsDone = (next: boolean) => {
    setTicketsFinished(next);
    if (!editSection) return;
    void queueSave(() =>
      handleSectionUpdateVis(editSection, "RENAME", undefined, { isDone: next })
    );
  };

  const saveTitleOnBlur = () => {
    if (!editSection || title.length === 0) return;
    if (title === editSection.section_title) return;
    void queueSave(() =>
      handleSectionUpdateVis(editSection, "RENAME", undefined, {
        section_title: title,
      })
    );
  };

  const updateManageColumnsAutoAssignCache = (
    projectId: number,
    sectionId: number,
    autoAssignUserId: number | null,
    autoAssignAgentId: string | null,
  ) => {
    queryClient.setQueryData<ISection[]>(
      [
        globalConstants.GetAllManageColumnsPrefixKey,
        projectId,
        currentUser.id,
      ],
      (cached) =>
        cached?.map((section) =>
          (section.id ?? section.sectionId) === sectionId
            ? { ...section, autoAssignUserId, autoAssignAgentId }
            : section,
        ),
    );
  };

  const updateProjectAutoAssignCaches = async (
    projectId: number,
    sectionId: number,
    autoAssignUserId: number | null,
    autoAssignAgentId: string | null,
  ) => {
    // A board request that started before this save could otherwise overwrite
    // the patched value when it resolves. Stop those requests first.
    await Promise.all([
      queryClient.cancelQueries({ queryKey: ["projectsAll"], exact: true }),
      queryClient.cancelQueries({ queryKey: ["projectsAllMinimal"] }),
    ]);
    const updateProject = (project: IProject) =>
      applySectionAutoAssignToProject(project, projectId, sectionId, {
        autoAssignUserId,
        autoAssignAgentId,
      });

    setCurrentProject((project) => (project ? updateProject(project) : project));
    queryClient.setQueryData<IProjectsAll>(["projectsAll"], (cached) =>
      cached
        ? {
            ...cached,
            updatedProjects: cached.updatedProjects.map(updateProject),
          }
        : cached,
    );
    queryClient.setQueriesData<IProject[]>(
      { queryKey: ["projectsAllMinimal"] },
      (cached) => cached?.map(updateProject),
    );
  };

  const saveAutoAssign = async (
    projectId: number,
    sectionId: number,
    autoAssignUserId: number | null,
  ) => {
    try {
      await axios.post("/api/sections/auto-assign", {
        sectionId,
        autoAssignUserId,
        autoAssignAgentId: null,
      });
      setEditSection((current) =>
        current?.id === sectionId
          ? { ...current, autoAssignUserId, autoAssignAgentId: null }
          : current,
      );
      updateManageColumnsAutoAssignCache(
        projectId,
        sectionId,
        autoAssignUserId,
        null,
      );
      // Refetching the active board remounts the command tree and closes this
      // editor. Patch its caches instead so the save is visible immediately.
      await updateProjectAutoAssignCaches(
        projectId,
        sectionId,
        autoAssignUserId,
        null,
      );
    } catch (error) {
      toast.error("Unable to update column auto-assign");
    }
  };

  const saveAgentAutoAssign = async (
    projectId: number,
    sectionId: number,
    autoAssignAgentId: string,
  ) => {
    try {
      await axios.post("/api/sections/auto-assign", {
        sectionId,
        autoAssignUserId: null,
        autoAssignAgentId,
      });
      setEditSection((current) =>
        current?.id === sectionId
          ? { ...current, autoAssignAgentId, autoAssignUserId: null }
          : current,
      );
      updateManageColumnsAutoAssignCache(
        projectId,
        sectionId,
        null,
        autoAssignAgentId,
      );
      await updateProjectAutoAssignCaches(
        projectId,
        sectionId,
        null,
        autoAssignAgentId,
      );
    } catch (error) {
      toast.error("Unable to update column auto-assign");
    }
  };

  const autoAssignName = editSection?.autoAssignUserId
    ? membersById.get(editSection.autoAssignUserId)?.displayName ||
      membersById.get(editSection.autoAssignUserId)?.email ||
      "Member"
    : "Nobody";
  const displayedAutoAssignName = editSection?.autoAssignAgentId
    ? agentsById.get(editSection.autoAssignAgentId)?.displayName || "Agent"
    : autoAssignName;

  // CONFIRM DELETE
  const confirmDelete = async () => {
    // Queued and awaited: firing this while a row save is still in flight used to
    // hit the `updating` guard, drop the delete, and still close the dialog and
    // return to the list as though the column had gone.
    await queueSave(() => handleSectionUpdateVis(editSection!, "DELETE"));
    setEditMode((prev) => !prev);
    setDeleteModal(false);
  };

  const closeBtn = editMode && (
    <ArrowLeft size={18} strokeWidth={1.75}
      className="close cursor-pointer hover:text-heading transition-all "
      onClick={goBack}
    />
  );

  const handleChangeSetting = (e: any) => {
    if (showEmpty) {
      handleEmptySections("Hidden");
      setShowEmpty(false);
    } else {
      handleEmptySections("Show");
      setShowEmpty(true);
    }
  };

  useEffect(() => {
    const setting = getActiveEmptySectionSettingFromProject(currentProject);
    setShowEmpty(setting === "Show" ? true : false);
  }, []);

  // Reactstrap does not keep a parent modal stable when a child modal closes.
  // Replace the column editor with the picker, then restore it after selection.
  const assignSectionId = editSection?.id;
  if (assignOpen && currentProject && editSection && assignSectionId) {
    const assignProjectId = currentProject.id;
    return (
      <AssignModal
        mode="Create"
        project={currentProject}
        title={`Auto-assign for ${editSection.section_title}`}
        includeAgents
        selectedUserIds={
          editSection.autoAssignUserId ? [editSection.autoAssignUserId] : []
        }
        selectedAgentIds={
          editSection.autoAssignAgentId ? [editSection.autoAssignAgentId] : []
        }
        extraUsers={[
          {
            id: 0,
            displayName: "Nobody",
            assigned: hasNoSectionAutoAssign(editSection),
          } as IUser,
        ]}
        assignees={[]}
        onClose={(assignee?: IUser | IAgent) => {
          setAssignOpen(false);
          if (!assignee) return;
          if (typeof assignee.id === "string") {
            const agentId = assignee.id;
            void queueSave(() =>
              saveAgentAutoAssign(
                assignProjectId,
                assignSectionId,
                agentId,
              ),
            );
            return;
          }
          const userId = assignee.id;
          void queueSave(() =>
            saveAutoAssign(
              assignProjectId,
              assignSectionId,
              userId === 0 ? null : userId,
            ),
          );
        }}
      />
    );
  }

  return (
    <ModalContainerCustom
      fade={false}
      toggle={() => toggleModal(false)}
      show={true}
      isOpen={true}
      id="inviteMemberModal"
      className="paletteModalSizing text-white-black bg-modalBackground rounded-[5px] p-0 assignUserModal absolute right-0 left-0 mx-auto max-h-[400px] sm:min-w-[560px] sm:top-[24%]"
    >
      <ModalHeader
        close={closeBtn}
        className="rounded-none bg-modalBackground border-b-0 h-[48px] px-4 text-emphasis font-medium [&>*:first-child]:w-full"
      >
        <div className="flex gap-3 justify-between items-center">
          <span>{!editMode ? "Manage board columns" : "Edit board column"}</span>
          {!editMode && (
            <div className="flex gap-3 items-center">
              <SettingsToggle
                label="Show empty board columns"
                inputId="flexSwitchCheckChecked"
                checked={showEmpty}
                onChange={handleChangeSetting}
              />

              <Plus size={16} strokeWidth={1.75}
                onClick={() => toggleModal(true)}
                className="cursor-pointer text-white-black"
              />
            </div>
          )}
        </div>
      </ModalHeader>
      <ModalBody className="bg-modalBackground max-h-[364px] overflow-y-scroll text-dense">
        {!editMode ? (
          <>
            <DragDropContext onDragEnd={onDragEndHandler}>
              <Droppable
                type="COLUMN"
                droppableId={"sections"}
                key={"sections"}
              >
                {(provided) => (
                  <div {...provided.droppableProps} ref={provided.innerRef}>
                    {columnRows.map(({ section, taskCount }, _index) => (
                        <Draggable
                          key={`section-${_index}`}
                          draggableId={`section-${_index}`}
                          index={_index}
                        >
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.draggableProps}
                              {...provided.dragHandleProps}
                              className="mx-1.5 flex h-[36px] items-center justify-between rounded-sm px-3 text-dense"
                              key={_index}
                            >
                              <div className="flex min-w-0 items-center gap-[6px]">
                                <span className="truncate">
                                  {section.section_title}
                                </span>
                                <span
                                  aria-label={`${taskCount} ${
                                    taskCount === 1 ? "task" : "tasks"
                                  }`}
                                  className="manage-column-task-count shrink-0 text-meta font-medium tabular-nums text-text-light-gray"
                                >
                                  {taskCount}
                                </span>
                              </div>
                              <div className="flex shrink-0 gap-4 items-center">
                                <div className="cursor-move no-drag-style">
                                  <Menu size={16} strokeWidth={1.75} />
                                </div>
                                <Settings size={16} strokeWidth={1.75}
                                  className="cursor-pointer hover:text-subheading transition-all "
                                  onClick={() => openEditView(section)}
                                />
                                <div
                                  className={`${
                                    updating ? "cursor-wait" : "cursor-pointer "
                                  }hover:text-subheading`}
                                  onClick={() =>
                                    handleSectionUpdateVis(section)
                                  }
                                >
                                  {section.visibility ? (
                                    <SquareCheck size={16} strokeWidth={1.75} className="transition-all" />
                                  ) : (
                                    <Square size={16} strokeWidth={1.75} className="transition-all" />
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          </>
        ) : (
          <>
            {/* One row per setting, matching the Settings board rows in
                BoardGeneralSection: label left, control right, hairline between. */}
            <div className="flex min-h-[40px] items-center justify-between gap-4 border-b border-light-black-border-1 px-4 py-2">
              <label
                htmlFor="edit-column-name"
                className="shrink-0 text-dense font-semibold text-white-black"
              >
                Name
              </label>
              <input
                autoFocus
                id="edit-column-name"
                className="min-w-0 flex-1 bg-transparent text-right text-dense font-medium text-white-black outline-none placeholder:text-text-light-gray"
                placeholder="Enter column name"
                value={title}
                onChange={onKeyChange}
                onBlur={isMobile ? undefined : saveTitleOnBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onSubmit();
                  }
                }}
              />
            </div>

            <div className="border-b border-light-black-border-1 px-2 py-1">
              <SettingsToggle
                checked={ticketsFinished}
                description="Ends the ticket's cycle. Reports, Inbox Zero and agents all treat it as done."
                inputId="edit-column-is-done"
                label="Tickets here are finished"
                onChange={() => saveIsDone(!ticketsFinished)}
              />
            </div>

            <button
              type="button"
              className="flex w-full min-h-[40px] items-center justify-between gap-4 border-b border-light-black-border-1 px-4 py-2 text-left transition hover:bg-hover-active focus-visible:bg-hover-active focus-visible:outline-none"
              onClick={() => setAssignOpen(true)}
            >
              <span className="shrink-0 text-dense font-semibold text-white-black">
                Auto-assign
              </span>
              <span className="min-w-0 truncate text-dense font-medium text-text-light-gray">
                {displayedAutoAssignName}
              </span>
            </button>

            <div className="px-4 pt-5 text-micro font-semibold uppercase tracking-wider text-text-light-gray">
              Danger zone
            </div>
            <div className="mt-1 flex min-h-[40px] items-center justify-between gap-4 border-t border-light-black-border-1 px-4 py-2">
              <div className="min-w-0">
                <span className="text-dense font-semibold text-white-black">
                  Delete board column
                </span>
                <p className="text-dense font-medium text-text-light-gray">
                  Its tickets move to the first column.
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 border-0 bg-transparent p-0 text-dense text-red-400 transition hover:text-red-300"
                onClick={() => setDeleteModal(true)}
              >
                Delete
              </button>
            </div>

            {isMobile && (
              <ModalFooter className="border-t border-light-black-border-1 px-4 py-2 flex items-center justify-end">
                <button
                  type="button"
                  className="inline-flex h-[28px] cursor-pointer items-center justify-center rounded-sm px-3 text-dense font-medium bg-label-span text-white-black hover:bg-hover-active border-0"
                  onClick={onSubmit}
                >
                  Save
                </button>
              </ModalFooter>
            )}

            {/* --------------- DELETE CONFIRM MODAL ------------------- */}
            {deleteModal && (
              <ConfirmDialog
                id="delete-column-confirm"
                icon={Trash2}
                message={`Delete board column “${editSection?.section_title}”?`}
                confirmLabel="Delete board column"
                onConfirm={confirmDelete}
                onCancel={() => setDeleteModal(false)}
              />
            )}

          </>
        )}
      </ModalBody>
    </ModalContainerCustom>
  );
};

export default ManageColumns;
