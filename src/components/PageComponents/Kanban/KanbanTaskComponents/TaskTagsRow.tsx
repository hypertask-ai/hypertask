import DueDateLabel from '@/components/Labels/DueDateLabel';
import LabelWrapper from '@/components/Labels/LabelWrapper';
import { FaRobot } from 'react-icons/fa6';
import TaskLabelComponent from '@/components/Modals/CreateLabel/TaskLabelComponent';
import EstimateLabelComponent from '@/components/Modals/TaskEstimate/EstimateLabelComponent';
import PriorityLabelComponent from '@/components/Modals/TaskPriority/PriorityLabelComponent';
import { IAgent, IEstimate, IPriority, IProject, ITaskLabel, ITask } from '@/models/model';
import { formatElapsed, useTimerNow } from '@/components/PageComponents/TaskDetail/TaskInfoColumn/TaskTime';
import { useBoardRunningTimers } from '@/hooks/Task Detail/useTimeTracking';
import { displayedBoardTimeSeconds, type BoardTimeTotal } from '@/lib/boardTimeTotals';
import { useQuery } from '@tanstack/react-query';
import type { CustomFieldType } from '@prisma/client';
import axios from 'axios';
import React from 'react'
import BlockerChip, { BlockerTaskChip, type BlockerUser } from './BlockerChip';

interface ITaskTopRow {
    task:ITask;
    project?:IProject;
    setShowEstimateModal:React.Dispatch<React.SetStateAction<boolean>>;
    setShowPriorityModal:React.Dispatch<React.SetStateAction<boolean>>;
    setShowCreateLabelModal:React.Dispatch<React.SetStateAction<boolean>>;
    setShowAssignModal:React.Dispatch<React.SetStateAction<boolean>>;
    toggleDueDate:()=>void;
    updateActiveItemAndItemInView:(task:ITask)=>void;
    dueDate:Date|undefined;
    priority:IPriority;
    estimate:IEstimate;
    taskLabels?:ITaskLabel[];
    hasDraft?: boolean;
    blockingUser?: BlockerUser;
    agents?: IAgent[];
}
const TaskTagsRow:React.FC<ITaskTopRow>  = ({
    task,
    project,
    setShowEstimateModal,
    setShowPriorityModal,
    setShowCreateLabelModal,
    setShowAssignModal,
    toggleDueDate,
    updateActiveItemAndItemInView:updateTaskFocus,
    dueDate,priority, estimate, taskLabels, hasDraft = false, blockingUser, agents = []}) => {

      const {
        showTimeTotals,
        timers: runningTimers,
        timeTotals,
      } = useBoardRunningTimers(task.projectId, { project })
      const runningTimer = runningTimers.get(task.id)
      const timeTotal = timeTotals.get(task.id)
      // ponytail: ITask has no customFieldValues in the shared model yet (HTPR-3805 is
      // still landing in pieces); board payload includes it, so cast locally like
      // TableView.tsx's getCustomFieldValue does, rather than widen the shared type.
      const customFieldValues = (task as ITask & { customFieldValues?: CustomFieldValue[] }).customFieldValues


      const handleClick = async(modal:"Priority"|"Estimate"|"TaskLabels"|"DueDate"|"Assignees") => {
        updateTaskFocus(task)
        // task.sectionId && await Learn more about JS/TS refactorings
    // updateActiveItemAndItemInView(task.id, task.projectId, task.sectionId)
        
        if (modal==="Assignees") setShowAssignModal(true)
        else if (modal==="Estimate") setShowEstimateModal(true)
        else if (modal==="Priority")  setShowPriorityModal(true)
        else if (modal==="TaskLabels") setShowCreateLabelModal(true)
        else if (modal==="DueDate") toggleDueDate()
      }
      
  const hasCustomFieldValues = (customFieldValues?.length ?? 0) > 0;

  return (

    agents.length>0||blockingUser||(task.blockingTasks?.length ?? 0)>0||runningTimer||(showTimeTotals && (timeTotal?.totalSeconds ?? 0) > 0)||hasDraft||priority||estimate||dueDate||(taskLabels&&taskLabels?.length>0)||hasCustomFieldValues?
    <div className={`basis-full flex gap-1 flex-wrap`}>
    {agents.map((agent) => (
      <AgentChip
        key={`agent-${agent.id}`}
        agent={agent}
        onClick={() => handleClick("Assignees")}
      />
    ))}
    {blockingUser && <BlockerChip user={blockingUser} />}
    {task.blockingTasks?.map((blockingTask) => (
      <BlockerTaskChip key={blockingTask.id} task={blockingTask} />
    ))}
    {(runningTimer || (showTimeTotals && (timeTotal?.totalSeconds ?? 0) > 0)) && (
      <TaskTimeBadge
        startedAt={runningTimer?.startedAt}
        pausedAt={runningTimer?.pausedAt}
        showTotal={showTimeTotals}
        total={timeTotal}
      />
    )}
    {hasDraft && (
      <span className="text-hypertasks-green font-medium leading-[22px]" style={{ fontSize: 11 }}>
        Draft
      </span>
    )}
    {/* ============ priorty and labels section  ==============*/}
    {
      dueDate ?
      <>
      <DueDateLabel
        stopPropogation={true}
        flexBasis={false}
        fontWeight={500}
        onClick={()=>handleClick("DueDate")}
        dueDate={dueDate}
      />
      </>
      :<></>
          
    }
    {priority?
              // {/* ---------- priority label */}
              <>
                <PriorityLabelComponent 
                  stopPropogation={true}
                  flexBasis={false}
                  fontWeight={500}
                  onClick={()=>handleClick("Priority")}
                  priority={priority}/>

              </>
            :
            <></>
          }
          {estimate?
              // {/* ---------- Estimate label */}
              <>
                <EstimateLabelComponent 
                  flexBasis={false}
                  fontWeight={500}
                  onClick={()=>handleClick("Estimate")}
                  estimate={estimate}/>

              </>
            :
            <></>
          }


          {/* ===================== task labels (capped, +N overflow) ================= */}
          {(() => {
            // ponytail: cap visible tags at 3 so the title stays readable; rest collapse to +N
            const MAX_LABELS = 3;
            const labels = (taskLabels ?? []).filter(l => l.label?.value);
            const extra = labels.length - MAX_LABELS;
            return (
              <>
                {labels.slice(0, MAX_LABELS).map((taskLabel) => (
                  <TaskLabelComponent
                    key={`Label-component-${taskLabel.id}`}
                    stopPropogation={true}
                    fontWeight={500}
                    onClick={() => handleClick("TaskLabels")}
                    flexBasis={false}
                    labelValue={taskLabel.label?.value ?? ""} />
                ))}
                {extra > 0 && (
                  <span
                    onClick={() => handleClick("TaskLabels")}
                    className="opacity-60 cursor-pointer"
                    style={{ fontSize: 11 }}
                  >
                    +{extra}
                  </span>
                )}
              </>
            );
          })()}

          {/* ===================== custom field chips (cap 3, quiet overflow) ================= */}
          <CustomFieldChips projectId={task.projectId} values={customFieldValues} />

          {/* ===================== sub task count ================= */}
    </div>
    :<></>
  )
}

type TCustomField = { id: string; name: string; type: CustomFieldType };
type CustomFieldValue = { fieldId: string; value: string; numericValue: number | null };

// An agent chip has to be tellable apart from a tag chip at a glance, or the
// whole point of splitting agents out is lost. It reuses the label pill's fill
// and geometry and adds the robot the sidebar already uses for agent counts,
// rather than inventing a marker (HTPR-5054).
const AgentChip = ({ agent, onClick }: { agent: IAgent; onClick: () => void }) => (
  <LabelWrapper
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }}
    className="cursor-pointer"
  >
    <FaRobot className="h-3 w-3 shrink-0 text-icon-dark-gray" />
    <span className="truncate">{agent.displayName}</span>
  </LabelWrapper>
);

// ponytail: reuses the same ["customFields", projectId] query key as TableView —
// react-query dedupes the fetch across every card, no per-card network call.
const CustomFieldChips = ({ projectId, values }: { projectId: number; values?: CustomFieldValue[] }) => {
  const { data: customFields = [] } = useQuery<TCustomField[]>({
    queryKey: ["customFields", projectId],
    queryFn: async () => (await axios.get(`/api/customFields?projectId=${projectId}`)).data,
    enabled: !!projectId && (values?.length ?? 0) > 0,
  });

  if (!values?.length || !customFields.length) return null;

  const valueByFieldId = new Map(values.map((v) => [v.fieldId, v]));

  // ponytail: cap at 3 field chips, no "+N" overflow — stays quiet per no-new-chrome rule
  const MAX_FIELD_CHIPS = 3;
  const chips = customFields
    .map((field) => {
      const value = valueByFieldId.get(field.id);
      if (!value) return null;
      const display =
        field.type === "Number" && value.numericValue !== null
          ? String(value.numericValue)
          : value.value;
      return { field, display };
    })
    .filter((c): c is { field: TCustomField; display: string } => !!c)
    .slice(0, MAX_FIELD_CHIPS);

  return (
    <>
      {chips.map(({ field, display }) => (
        <TaskLabelComponent
          key={`custom-field-${field.id}`}
          fontWeight={500}
          flexBasis={false}
          labelValue={`${field.name} ${display}`}
        />
      ))}
    </>
  );
};

const TaskTimeBadge = ({
  startedAt,
  pausedAt,
  showTotal,
  total,
}: {
  startedAt?: string;
  pausedAt?: string | null;
  showTotal: boolean;
  total?: BoardTimeTotal;
}) => {
  const hasActiveTimer = showTotal
    ? total?.runningTimers.some((timer) => timer.pausedAt === null) ?? false
    : Boolean(startedAt && !pausedAt)
  const now = useTimerNow(hasActiveTimer)
  const end = pausedAt ? new Date(pausedAt).getTime() : now
  const seconds = showTotal
    ? displayedBoardTimeSeconds(total, now)
    : startedAt
      ? Math.max(
          0,
          Math.floor((end - new Date(startedAt).getTime()) / 1000)
        )
      : 0

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium leading-[22px] ${hasActiveTimer ? "text-hypertasks-green" : "text-text-light-gray"}`}
      style={{ fontSize: 11 }}
    >
      {hasActiveTimer && <span className="text-[8px]">▶</span>}
      {formatElapsed(seconds)}
    </span>
  )
}

export default TaskTagsRow
