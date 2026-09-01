import React, {
  Suspense,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useRecoilState } from "@/lib/state";
import {
  AssigneeCard,
  ClickableSpan,
  LocalRightSideInfo,
  TaskInfoColumnContainer,
  TaskInfoLabel,
  TaskInfoRow,
  TaskInfoValue,
} from "@/components/PageComponents/TaskDetail/MainPageComponents";
import { useDeviceContext } from "@/lib/contexts/deviceContext";
import useCopyURL from "@/hooks/General/useCopyURL";
import AssigneesContainer from "../AssigneesContainer";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import Tooltip from "@/components/Common/Tooltip";
import PriorityLabelComponent from "@/components/Modals/TaskPriority/PriorityLabelComponent";
import TaskLabelComponent from "@/components/Modals/CreateLabel/TaskLabelComponent";
import {
  ISection,
  ITask,
  ITaskLabel,
  IUser,
  IAssignees,
  ICycle,
} from "@/models/model";
import RelatedTaskLabel from "./RelatedTaskLabel";
import { useProjectQuery } from "@/hooks/General/useProjectQuery";
import { ArrowRight, CornerLeftUp, TriangleAlert } from "lucide-react";
import DueDateLabel from "@/components/Labels/DueDateLabel";
import { EstimateConstants } from "@/lib/constants/constants";
import taskDetailConfig from "@/lib/configs/taskDetail.config";
import TaskTime from "./TaskTime";
import { daysSince, stalenessLevel } from "@/lib/staleness";
import { cn } from "@/utils/undoActions/helperFuncs";
import { showCommandsAtom } from "@/store";
import { CommandMode } from "@/models/enums";
import { RECURRENCE_LABELS, type RecurrenceRule } from "@/lib/recurrence";
import { useGetAllMembersForAssign } from "@/hooks/MultiPages/useGetMembersForAssignees";
import CyclePicker from "@/components/Modals/CyclePicker";
import {
  formatWaitingOnAge,
  WAITING_ON_OVERDUE_MS,
} from "@/lib/waitingOn";

type RelationDirection = "from" | "to";

const getRelationSectionTitle = (
  relationType: string,
  direction: RelationDirection
) => {
  if (relationType === "BlockedBy")
    return direction === "from" ? "Blocked by" : "Blocks";
  if (relationType === "BlockedTo")
    return direction === "from" ? "Blocks" : "Blocked by";
  if (relationType === "Duplicate")
    return direction === "from" ? "Duplicate of" : "Duplicate";
  return "Related";
};
import { CustomFieldType } from "@prisma/client";

export interface ICustomField {
  id: number;
  name: string;
  type: CustomFieldType;
  options: { id: string; label: string }[] | null;
  ranking: string;
  showInRail?: boolean | null;
}

export interface ICustomFieldValue {
  fieldId: number;
  value: string;
  numericValue: number | null;
}

export interface ITaskInfoContainer {
  dynamicTopValue: number;
  toggleModal: (_assignees?: IAssignees[]) => void;
  showAssignModal: boolean;
  slugs: string[];
  _parsedTask: ITask;
  sectionsForProjectTQ: any;
  toggleMoveModal: () => void;
  moveTaskToNextColumn(sectionToMoveTo: ISection): Promise<void>;
  toggleDueDate: (refresh?: boolean) => void;
  toggleMoveToBoardModal: () => void;
  togglePriorityModal: (refresh?: boolean) => void;
  toggleEstimateModal: (refresh?: boolean) => void;
  estimate_: any;
  priority_: any;
  toggleLabelModal: (taskLabels?: ITaskLabel[], refresh?: boolean, shouldCloseOnUpdate?: boolean) => void;
  labelsFromTQ: any;
  currentTask: ITask & {
    customFieldValues?: ICustomFieldValue[];
    project?: ITask["project"] & { customFields?: ICustomField[] };
  };
  removeRelationHandler: (relationId: number) => Promise<void>;
  followers: any[];
  updateWaitingOn: (fields: {
    waitingOnUserId: number | null;
    waitingOnSetById: number | null;
    waitingOnSetAt: string | null;
  }) => void;
  updateCycle: (cycle: ICycle | null) => void;
}

const TaskInfo = (props: ITaskInfoContainer) => {
  const {
    dynamicTopValue,
    showAssignModal,
    slugs,
    _parsedTask,
    sectionsForProjectTQ,
    toggleDueDate,
    toggleEstimateModal,
    toggleLabelModal,
    toggleMoveModal,
    toggleMoveToBoardModal,
    togglePriorityModal,
    estimate_,
    priority_,
    currentTask,
    labelsFromTQ,
    moveTaskToNextColumn,
    removeRelationHandler,
    toggleModal,
    followers,
    updateWaitingOn,
    updateCycle,
  } = props;
  const queryClient = useQueryClient();
  const [showCyclePicker, setShowCyclePicker] = useState(false);
  const [, setShowCommands] = useRecoilState(showCommandsAtom);
  const isApple = useDeviceContext();
  const _mbl = useContext(MobileViewContext);
  const { copyTicketNumber } = useCopyURL();
  const { goToProjectShortcut } = useProjectQuery();
  const { data: membersAndOwner } = useGetAllMembersForAssign(
    ["waiting-on-members", currentTask.projectId],
    currentTask.projectId
  );
  const waitingOnUser = useMemo(() => {
    const users: IUser[] = [
      ...(membersAndOwner?.owner ? [membersAndOwner.owner] : []),
      ...(membersAndOwner?.members ?? []).map(
        (member: { user: IUser }) => member.user
      ),
    ];
    return users.find((user) => user.id === currentTask.waitingOnUserId);
  }, [currentTask.waitingOnUserId, membersAndOwner]);
  const [waitingOnNow] = useState(() => Date.now());
  const waitingOnAge = formatWaitingOnAge(
    currentTask.waitingOnSetAt,
    waitingOnNow
  );
  const waitingOnIsOverdue = currentTask.waitingOnSetAt
    ? waitingOnNow - new Date(currentTask.waitingOnSetAt).getTime() >
      WAITING_ON_OVERDUE_MS
    : false;
  const openWaitingOnPicker = () =>
    setShowCommands({ show: true, mode: CommandMode.OpenBlockedByModal });
  const clearWaitingOn = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const response = await axios.post("/api/tasks/waiting-on", {
        taskId: currentTask.id,
        userId: null,
      });
      updateWaitingOn(response.data);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["task-", currentTask.id],
        }),
        queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      ]);
    } catch {
      toast.error("Unable to clear blocked by person");
    }
  };
  const inColumnDays = daysSince(
    currentTask.sectionChangedAt ?? currentTask.createdAt
  );
  const lastCommentDays = daysSince(currentTask.lastCommentAt);
  const onBoardDays = daysSince(currentTask.createdAt);
  // Staleness collapses to one line, shown only when actually stale. Comment age
  // falls back to board age when the task was never commented (matches taskStaleness).
  const commentDays = lastCommentDays ?? onBoardDays;
  const staleLevel = stalenessLevel(
    Math.max(inColumnDays ?? 0, commentDays ?? 0),
    {
      warnDays: currentTask.project?.staleWarnDays,
      hotDays: currentTask.project?.staleHotDays,
    },
  );
  const relationItems = [
    ...(currentTask.relatedFromTasks ?? []).map((relation) => ({
      relation,
      task: relation.targetTask,
      title: getRelationSectionTitle(String(relation.relationType), "from"),
    })),
    ...(currentTask.relatedToTasks ?? []).map((relation) => ({
      relation,
      task: relation.sourceTask,
      title: getRelationSectionTitle(String(relation.relationType), "to"),
    })),
  ];
  const relationSections = [
    "Blocked by",
    "Blocks",
    "Duplicate of",
    "Duplicate",
    "Related",
  ]
    .map((title) => ({
      title,
      items: relationItems.filter((item) => item.title === title),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <TaskInfoColumnContainer
      // HTPR-3753: h-full made this sticky column as tall as the whole ticket.
      // A sticky element taller than the viewport stops sticking once its
      // bottom edge scrolls past, so the properties drifted up on long tasks,
      // and its height padded the row with dead space you had to scroll
      // through before reaching the last comment (HTPR-3752). Size it to its
      // content, capped at the viewport, and scroll inside when it overflows.
      // Short property lists must not stretch the rail to the screen height.
      heightVariant="fit"
      style={
        _mbl
          ? { top: dynamicTopValue }
          : {
              top: dynamicTopValue,
              maxHeight: `calc(100dvh - ${dynamicTopValue}px - 16px)`,
              overflowY: "auto",
              overscrollBehavior: "contain",
            }
      }
    >
      {/* ====================================== ASSIGNEES ================================ */}

      <AssigneesContainer
        showAssigneeModal={showAssignModal}
        toggleAssigneeModal={toggleModal}
        slugs={slugs}
        currentTask={currentTask}
      />

      {currentTask.waitingOnUserId && (
        <TaskInfoRow>
          <LocalRightSideInfo
            onClick={openWaitingOnPicker}
            title="Waiting on"
            left={0}
            bottom={-40}
            tooltipText="Change blocked by person"
            KeyCombination={["B"]}
          />
          <TaskInfoValue
            onClick={openWaitingOnPicker}
            className="cursor-pointer group"
          >
            <span className="inline-flex max-w-full items-center gap-1.5 font-medium text-white-black">
              <span className="truncate">
                {waitingOnUser?.displayName ?? "Unknown user"}
              </span>
              {waitingOnAge && (
                <span
                  className={cn(
                    "shrink-0",
                    waitingOnIsOverdue
                      ? "text-red-600 dark:text-red-400"
                      : "text-text-light-gray"
                  )}
                >
                  · {waitingOnAge}
                </span>
              )}
              <button
                type="button"
                aria-label="Clear blocked by person"
                className="shrink-0 text-text-light-gray hover:text-white-black"
                onClick={clearWaitingOn}
              >
                ✕
              </button>
            </span>
          </TaskInfoValue>
        </TaskInfoRow>
      )}

      {/* ===================================== TASK ID ====================================== */}
      {currentTask?.ticketNumber && (
        <TaskInfoRow>
          <>
            <LocalRightSideInfo
              onClick={() => copyTicketNumber(currentTask.ticketNumber ?? "")}
              title="ID"
              left={0}
              bottom={-40}
              tooltipText="Copy task ID"
              key={"ID"}
              KeyCombination={[isApple ? "CMD" : "CTRL", "SHIFT", "I"]}
            />

            <TaskInfoValue
              onClick={() => copyTicketNumber(currentTask.ticketNumber ?? "")}
              className={`${_mbl ? "text-white-black" : "w-full cursor-pointer"} group w-full`}
            >
              <ClickableSpan
                className="task-ticket-id"
                title={currentTask.ticketNumber.toUpperCase() ?? ""}
              />
              <Tooltip
                portal
                left={0}
                bottom={-40}
                keyCombination={[isApple ? "CMD" : "CTRL", "I"]}
                text={"Copy task title & ID"}
              />
              <Tooltip
                portal
                left={0}
                bottom={-75}
                text="Copy task ID"
                keyCombination={[isApple ? "CMD" : "CTRL", "SHIFT", "I"]}
              />
            </TaskInfoValue>
          </>
        </TaskInfoRow>
      )}

      {/* ====================================== TASK STATUS ================================ */}
      <TaskInfoRow>
        {(() => {
          const i = sectionsForProjectTQ?.findIndex(
            (s: { id: number | undefined }) => s.id === currentTask.sectionId
          ) ?? -1;
          const next =
            i >= 0 && i < (sectionsForProjectTQ?.length ?? 0) - 1
              ? sectionsForProjectTQ?.[i + 1]
              : null;

          return (
            <>
              <LocalRightSideInfo
                onClick={toggleMoveModal}
                title="Status"
                left={0}
                bottom={-40}
                tooltipText="Change Status"
                key="Status"
                KeyCombination={["M"]}
              />
              <TaskInfoValue className="w-full">
                <span className="inline-flex max-w-full flex-wrap gap-1.5 items-center">
                  <span
                    onClick={toggleMoveModal}
                    className="relative group inline-flex max-w-full min-w-0 cursor-pointer"
                  >
                    <Tooltip
                      portal
                      left={0}
                      bottom={-40}
                      text="Change Status"
                      keyCombination={["M"]}
                    />
                    <ClickableSpan title={currentTask?.section ?? ""} />
                  </span>
                  {next && (
                    <span
                      onClick={() => moveTaskToNextColumn(next)}
                      className="relative group ml-1 inline-block align-text-bottom cursor-pointer"
                    >
                      <ArrowRight
                        size={11}
                        className="mb-[2px] hover:text-white-black"
                       strokeWidth={1.75}/>
                    <Tooltip
                      portal
                      left={0}
                        bottom={-40}
                        text={`Move task to ${next.section_title}`}
                        keyCombination={["SHIFT", "L, →"]}
                      />
                    </span>
                  )}
                </span>
              </TaskInfoValue>
            </>
          );
        })()}
      </TaskInfoRow>

      {(currentTask.project?.cyclesEnabled || currentTask.cycle) && (
        <TaskInfoRow>
          <LocalRightSideInfo
            onClick={() => setShowCyclePicker(true)}
            title="Cycle"
            left={0}
            bottom={-40}
            tooltipText="Set cycle"
            KeyCombination={null}
          />
          <TaskInfoValue
            onClick={() => setShowCyclePicker(true)}
            className="cursor-pointer group"
          >
            <ClickableSpan title={currentTask.cycle ? `Cycle ${currentTask.cycle.number}` : "No cycle"} />
          </TaskInfoValue>
          {showCyclePicker && (
            <CyclePicker
              assignedCycle={currentTask.cycle ?? null}
              closeHandler={() => setShowCyclePicker(false)}
              onChange={updateCycle}
              taskId={currentTask.id}
            />
          )}
        </TaskInfoRow>
      )}

      {/* ====================================== TASK DUE DATE ================================ */}
      <TaskInfoRow>
        <LocalRightSideInfo
          onClick={toggleDueDate}
          title="Due date"
          left={0}
          bottom={-40}
          tooltipText="Set due date"
          key={"due date"}
          KeyCombination={["D"]}
        />

        <TaskInfoValue
          onClick={() => toggleDueDate()}
          className="cursor-pointer group"
        >
          <Tooltip
            portal
            left={0}
            bottom={-40}
            text="Set due date"
            keyCombination={["D"]}
          />
          <Suspense fallback={<></>}>
            {currentTask?.dueDate ? (
              <DueDateLabel
                stopPropogation={true}
                flexBasis={false}
                fontWeight={500}
                fontSize={_mbl ? 12 : 13}
                onClick={toggleDueDate}
                dueDate={currentTask?.dueDate}
                isTaskInfo={true}
              />
            ) : (
              "-"
            )}
          </Suspense>
        </TaskInfoValue>
      </TaskInfoRow>

      {/* ====================================== TASK START DATE (HTPR-4884) ================================ */}
      {currentTask?.startDate && (
        <TaskInfoRow>
          <LocalRightSideInfo
            onClick={() =>
              setShowCommands({ show: true, mode: CommandMode.SetStartDate })
            }
            title="Start date"
            left={0}
            bottom={-40}
            tooltipText="Set start date"
            key={"start date"}
            KeyCombination={null}
          />
          <TaskInfoValue
            onClick={() =>
              setShowCommands({ show: true, mode: CommandMode.SetStartDate })
            }
            className="cursor-pointer group"
          >
            <Suspense fallback={<></>}>
              <DueDateLabel
                stopPropogation={true}
                flexBasis={false}
                fontWeight={500}
                fontSize={_mbl ? 12 : 13}
                dueDate={currentTask.startDate}
                isTaskInfo={true}
              />
            </Suspense>
          </TaskInfoValue>
        </TaskInfoRow>
      )}

      {/* ====================================== TASK REPEAT (HTPR-4885) ================================ */}
      {currentTask?.recurrence && (
        <TaskInfoRow>
          <LocalRightSideInfo
            onClick={() =>
              setShowCommands({ show: true, mode: CommandMode.SetRecurrence })
            }
            title="Repeats"
            left={0}
            bottom={-40}
            tooltipText="Change repeat"
            key={"repeats"}
            KeyCombination={null}
          />
          <TaskInfoValue
            onClick={() =>
              setShowCommands({ show: true, mode: CommandMode.SetRecurrence })
            }
            className="cursor-pointer group"
          >
            {RECURRENCE_LABELS[currentTask.recurrence as RecurrenceRule] ??
              currentTask.recurrence}
          </TaskInfoValue>
        </TaskInfoRow>
      )}

      {currentTask.id > 0 && (
        <TaskTime
          taskId={currentTask.id}
          ticketId={currentTask.ticketNumber ?? String(currentTask.uniqueIndex)}
          title={currentTask.title}
        />
      )}

      {/* ====================================== TASK PROJECT ================================ */}
      <TaskInfoRow>
        <LocalRightSideInfo
          onClick={() => toggleMoveToBoardModal()}
          title={"Project"}
          left={0}
          bottom={-40}
          tooltipText="Change Project"
          key={"Change Project"}
          KeyCombination={["SHIFT", "M"]}
          className=""
        />

        <TaskInfoValue className="w-full cursor-pointer">
          <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
            {/* Project title */}
            <span
              onClick={() => toggleMoveToBoardModal()}
              className="relative group inline-flex max-w-full min-w-0"
            >
              <Tooltip
                portal
                left={0}
                bottom={-40}
                text="Change Project"
                keyCombination={["SHIFT", "M"]}
              />
              <ClickableSpan title={_parsedTask?.project?.title ?? ""} />
            </span>
            {/* Space between lines if it wraps */} {/* Icon */}
            <span
              onClick={() => goToProjectShortcut(_parsedTask.projectId, true)}
              className="relative group inline-block align-text-bottom"
            >
              <CornerLeftUp
                size={11}
                className="mb-[2px] scale-x-[-1] hover:text-white-black"
               strokeWidth={1.75}/>
              <Tooltip
                portal
                left={0}
                bottom={-40}
                text="Go to Project"
                keyCombination={["G", null, "B"]}
              />
            </span>
          </span>
        </TaskInfoValue>
      </TaskInfoRow>

      {/* ====================================== TASK Priority ================================ */}
      <TaskInfoRow>
        <LocalRightSideInfo
          onClick={togglePriorityModal}
          title="Priority"
          left={0}
          bottom={-40}
          tooltipText="Set priority"
          key={"priority"}
          KeyCombination={["P"]}
        />

        <TaskInfoValue
          onClick={() => togglePriorityModal()}
          className="cursor-pointer group"
        >
          <Tooltip
            portal
            left={0}
            bottom={-40}
            text="Set priority"
            keyCombination={["P"]}
          />
          <Suspense fallback={<></>}>
            {priority_ ? (
              <PriorityLabelComponent
                stopPropogation={false}
                fontSize={_mbl ? 12 : 13}
                priority={priority_}
              />
            ) : (
              <ClickableSpan title="No Priority" />
            )}
          </Suspense>
        </TaskInfoValue>
      </TaskInfoRow>

      {/* ====================================== TASK Estimate ================================ */}
      <TaskInfoRow>
        <LocalRightSideInfo
          onClick={toggleEstimateModal}
          title="Task size"
          left={0}
          bottom={-40}
          tooltipText="Set task size"
          key={"task size"}
          KeyCombination={["S"]}
        />

        <TaskInfoValue
          onClick={() => toggleEstimateModal()}
          className="cursor-pointer group"
        >
          <Tooltip
            portal
            left={0}
            bottom={-40}
            text="Set task size"
            keyCombination={["S"]}
          />
          <Suspense fallback={<></>}>
            <ClickableSpan
              title={
                (estimate_
                  ? EstimateConstants.find(
                    (x) => x.estimate_index === estimate_?.estimate_index
                  )?.estimate_full_value
                  : "-") ?? "-"
              }
            />
          </Suspense>
        </TaskInfoValue>
      </TaskInfoRow>

      {/* ====================================== TASK Labels ================================ */}
      <TaskInfoRow alignTop>
        <LocalRightSideInfo
          onClick={toggleLabelModal}
          title="Tags"
          left={0}
          bottom={-40}
          tooltipText="Set tags"
          key={"tags"}
          KeyCombination={["T"]}
        />

        {labelsFromTQ?.length > 0 ? (
          <TaskInfoValue
            onClick={() => toggleLabelModal()}
            className="flex flex-wrap gap-2 cursor-pointer group"
          >
            {labelsFromTQ?.map(
              (taskLabel: ITaskLabel, index: any) =>
                taskLabel.label?.value && (
                  <TaskLabelComponent
                    key={`task-label-${index}`}
                    flexBasis={false}
                    stopPropogation={false}
                    fontSize={_mbl ? 12 : 13}
                    labelValue={taskLabel.label?.value}
                    taskDetail={true}
                  />
                )
            )}
          </TaskInfoValue>
        ) : (
          <TaskInfoValue
            onClick={() => toggleLabelModal()}
            className="text-start cursor-pointer group"
          >
            <ClickableSpan title="No tags" />
            <Tooltip
              portal
              left={0}
              bottom={-40}
              text="Set tags"
              keyCombination={["T"]}
            />
          </TaskInfoValue>
        )}
      </TaskInfoRow>


      {/* ====================================== Custom Fields ================================ */}
      <CustomFieldRows task={currentTask} />

      {/* ====================================== Followers ================================ */}
      {followers.length > 0 && (
        <TaskInfoRow alignTop>
          <TaskInfoLabel>Followers</TaskInfoLabel>
          <TaskInfoValue
            className={_mbl ? "flex flex-row" : "flex flex-col"}
          >
            {followers.length < 1 && (
              <span style={{ color: "#8E9093" }}>The Assignees</span>
            )}
            {followers.length > 0 && (
              <div
                className={`text-white-black ${_mbl
                    ? "py-1 flex flex-row flex-wrap gap-1"
                    : "space-y-3 rounded-[4px]"
                  }`}
              >
                {followers?.map((item, i) => (
                  <AssigneeCard
                    user={item.agent ?? item.user}
                    _mbl={_mbl}
                    projectId={currentTask.projectId}
                    key={i}
                    i={i}
                  />
                ))}
              </div>
            )}
          </TaskInfoValue>
        </TaskInfoRow>
      )}

      {/* ====================================== Staleness (only when stale) ================================ */}
      {staleLevel !== "none" && (
        <div
          title={`${inColumnDays ?? 0}d in column · ${
            lastCommentDays === null
              ? "no comments yet"
              : `last comment ${lastCommentDays}d ago`
          } · ${onBoardDays ?? 0}d on board`}
          className={cn(
            "flex w-full shrink-0 items-center gap-1.5 text-dense font-medium",
            staleLevel === "hot"
              ? "text-red-600 dark:text-red-400"
              : "text-amber-600 dark:text-amber-500"
          )}
        >
          <TriangleAlert size={12} className="shrink-0" />
          <span>
            {inColumnDays ?? 0}d in column ·{" "}
            {lastCommentDays === null
              ? "no comments yet"
              : `${lastCommentDays}d since last comment`}
          </span>
        </div>
      )}

      {/* ====================================== TASK Relations ================================ */}
      {relationSections.map((section) => (
        <div
          className="flex shrink-0 flex-col items-start w-full gap-2 text-[#8E9093]"
          key={section.title}
        >
          <LocalRightSideInfo
            className="!w-full"
            onClick={() => { }}
            title={section.title}
            left={0}
            bottom={-40}
            tooltipText=""
            key={section.title}
            KeyCombination={[]}
            showTooltip={false}
          />

          <TaskInfoValue className="ml-0 flex flex-col gap-1 group w-full">
            {section.items.map(({ relation, task }) =>
              task ? (
                <RelatedTaskLabel
                  key={`task-relation-${relation.id}`}
                  relationInfo={{
                    title: task.title ?? "",
                    ticketNumber: task.ticketNumber?.toUpperCase() ?? "",
                    id: relation.id,
                    route: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
                  }}
                  onClick={removeRelationHandler}
                />
              ) : null
            )}
          </TaskInfoValue>
        </div>
      ))}
    </TaskInfoColumnContainer>
  );
};

// ── Custom field value editor (inline, per-field) ─────────────────────────────

function CustomFieldRows({
  task,
}: {
  task: ITaskInfoContainer["currentTask"];
}) {
  const customFields = task.project?.customFields ?? [];
  // Collapsed/expanded is per ticket-view state only — reopening the same
  // ticket (or a different one) starts collapsed again, no persistence.
  const [expanded, setExpanded] = useState(false);
  if (customFields.length === 0) return null;

  const shownFields = customFields.filter((field) => field.showInRail !== false);
  const hiddenFields = customFields.filter((field) => field.showInRail === false);

  const renderField = (field: ICustomField) => {
    const existing = task.customFieldValues?.find(
      (v) => v.fieldId === field.id
    );
    return (
      <CustomFieldRow
        key={field.id}
        field={field}
        existing={existing ?? null}
        taskId={task.id}
      />
    );
  };

  return (
    <>
      {shownFields.map(renderField)}
      {hiddenFields.length > 0 && !expanded && (
        <TaskInfoRow>
          <LocalRightSideInfo
            onClick={() => setExpanded(true)}
            title="More fields"
            left={0}
            bottom={-40}
            tooltipText="Show hidden fields"
            KeyCombination={[]}
            showTooltip={false}
          />
          <TaskInfoValue
            onClick={() => setExpanded(true)}
            className="cursor-pointer group"
          >
            <ClickableSpan
              title={`+ ${hiddenFields.length} more field${hiddenFields.length === 1 ? "" : "s"}`}
            />
          </TaskInfoValue>
        </TaskInfoRow>
      )}
      {expanded && hiddenFields.map(renderField)}
    </>
  );
}

function CustomFieldRow({
  field,
  existing,
  taskId,
}: {
  field: ICustomField;
  existing: ICustomFieldValue | null;
  taskId: number;
}) {
  // Local state for optimistic display — persists on reload via SSR
  const [savedValue, setSavedValue] = useState(existing?.value ?? "");
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(existing?.value ?? "");
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  async function save(val: string) {
    setEditing(false);
    if (val === savedValue) return; // no change
    setSavedValue(val); // optimistic update
    try {
      await axios.post("/api/customFields/value", {
        fieldId: field.id,
        taskId,
        value: val,
      });
    } catch (err) {
      console.error("CustomField upsert error:", err);
      setSavedValue(savedValue); // rollback
      toast.error(`Unable to save ${field.name}`);
    }
  }

  function startEditing() {
    setInputValue(savedValue);
    setEditing(true);
    setTimeout(() => (inputRef.current as HTMLElement | null)?.focus(), 0);
  }

  const displayValue = savedValue || null;

  return (
    <TaskInfoRow>
      <LocalRightSideInfo
        onClick={startEditing}
        title={field.name}
        left={0}
        bottom={-40}
        tooltipText={`Set ${field.name}`}
        key={`cf-${field.id}`}
        KeyCombination={[]}
        showTooltip={false}
      />
      <TaskInfoValue
        onClick={!editing ? startEditing : undefined}
        className={!editing ? "cursor-pointer group" : ""}
      >
        {editing ? (
          <CustomFieldInput
            field={field}
            value={inputValue}
            onChange={setInputValue}
            onSave={save}
            onCancel={() => setEditing(false)}
            inputRef={inputRef}
          />
        ) : displayValue !== null ? (
          <ClickableSpan title={displayValue} />
        ) : (
          <ClickableSpan title="Set value…" />
        )}
      </TaskInfoValue>
    </TaskInfoRow>
  );
}

function CustomFieldInput({
  field,
  value,
  onChange,
  onSave,
  onCancel,
  inputRef,
}: {
  field: ICustomField;
  value: string;
  onChange: (v: string) => void;
  onSave: (v: string) => void;
  onCancel: () => void;
  inputRef: React.MutableRefObject<HTMLInputElement | HTMLSelectElement | null>;
}) {
  const baseClass =
    "bg-transparent border-b border-[#8E9093] outline-none text-white-black text-[14px] w-full py-[2px]";

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      onSave(value);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  if (field.type === "Checkbox") {
    return (
      <button
        className="text-left text-[14px] text-white-black"
        onClick={() => onSave(value === "true" ? "" : "true")}
      >
        {value === "true" ? "Yes" : "No"}
      </button>
    );
  }

  if (field.type === "Select" && field.options && field.options.length > 0) {
    return (
      <select
        ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
        className={baseClass}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onSave(e.target.value);
        }}
        onBlur={() => onSave(value)}
        onKeyDown={handleKeyDown}
      >
        <option value="">— clear —</option>
        {field.options.map((opt) => (
          <option key={opt.id} value={opt.label}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "Date") {
    return (
      <input
        ref={inputRef as React.MutableRefObject<HTMLInputElement>}
        type="date"
        className={baseClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        onKeyDown={handleKeyDown}
      />
    );
  }

  if (field.type === "Number") {
    return (
      <input
        ref={inputRef as React.MutableRefObject<HTMLInputElement>}
        type="number"
        className={baseClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onSave(value)}
        onKeyDown={handleKeyDown}
        placeholder="0"
        step="any"
      />
    );
  }

  // Text (default)
  return (
    <input
      ref={inputRef as React.MutableRefObject<HTMLInputElement>}
      type="text"
      className={baseClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onSave(value)}
      onKeyDown={handleKeyDown}
      placeholder="Enter value…"
    />
  );
}

export default TaskInfo;
