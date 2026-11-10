import DueDateLabel from '@/components/Labels/DueDateLabel';
import LabelWrapper from '@/components/Labels/LabelWrapper';
import { FaRobot } from 'react-icons/fa6';
import TaskLabelComponent from '@/components/Modals/CreateLabel/TaskLabelComponent';
import EstimateLabelComponent from '@/components/Modals/TaskEstimate/EstimateLabelComponent';
import PriorityLabelComponent from '@/components/Modals/TaskPriority/PriorityLabelComponent';
import { IAgent, IEstimate, IPriority, IProject, ITaskLabel, ITask } from '@/models/model';
import { formatElapsed } from '@/lib/timeDuration';
import { useBoardRunningTimers, useTimerNow } from '@/hooks/Task Detail/useTimeTracking';
import { displayedBoardTimeSeconds, type BoardTimeTotal } from '@/lib/boardTimeTotals';
import { useQuery } from '@tanstack/react-query';
import type { CustomFieldType } from '@prisma/client';
import axios from 'axios';
import React from 'react'
import { useFlag } from '@/hooks/useFlag';
import { agentStatusIsFresh, agentStatusText, agentStepFor } from '@/lib/agentStatus/chip';
import { useMinuteClock } from '@/lib/agentStatus/minuteClock';
import AgentStatusChip from '@/lib/agentStatus/AgentStatusChip';
import BlockerChip, { BlockerTaskChip, type BlockerUser } from './BlockerChip';
import { useBoardCardData } from './BoardCardData';
import { HTPR_7677_BOARD_CARD_DATA_ONCE_FLAG } from '@/lib/flags/definitions/htpr-7677-board-card-data-once';
import { HTPR_8970_CALM_CARDS_FLAG } from '@/lib/flags/definitions/htpr-8970-calm-cards';
import { cardLabels } from '@/lib/kanban/cardLabels';
import { cn } from '@/utils/undoActions/helperFuncs';
import { HTPR_7339_AGENT_PULSE_DOT_FLAG } from '@/lib/flags/definitions/htpr-7339-agent-pulse-dot';

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
    cardOverflowClamp?: boolean;
}
type TaskTimeOnCard = {
    showTimeTotals: boolean;
    runningTimer?: { startedAt: string; pausedAt: string | null };
    timeTotal?: BoardTimeTotal;
}

const TaskTagsRow:React.FC<ITaskTopRow> = (props) => {
      const boardCardDataOnce = useFlag(HTPR_7677_BOARD_CARD_DATA_ONCE_FLAG)
      const boardCardData = useBoardCardData(props.task.projectId)
      if (!boardCardDataOnce || !boardCardData) return <TaskTagsRowWithOwnTimers {...props} />
      return (
        <TaskTagsRowContent
          {...props}
          showTimeTotals={boardCardData.showTimeTotals}
          runningTimer={boardCardData.runningTimers.get(props.task.id)}
          timeTotal={boardCardData.timeTotals.get(props.task.id)}
        />
      )
}

const TaskTagsRowWithOwnTimers:React.FC<ITaskTopRow> = (props) => {
      const { showTimeTotals, timers, timeTotals } = useBoardRunningTimers(props.task.projectId, { project: props.project })
      return (
        <TaskTagsRowContent
          {...props}
          showTimeTotals={showTimeTotals}
          runningTimer={timers.get(props.task.id)}
          timeTotal={timeTotals.get(props.task.id)}
        />
      )
}

const TaskTagsRowContent:React.FC<ITaskTopRow & TaskTimeOnCard>  = ({
    task,
    project,
    setShowEstimateModal,
    setShowPriorityModal,
    setShowCreateLabelModal,
    setShowAssignModal,
    toggleDueDate,
    updateActiveItemAndItemInView:updateTaskFocus,
    dueDate,priority, estimate, taskLabels, hasDraft = false, blockingUser, agents = [],
    showTimeTotals, runningTimer, timeTotal, cardOverflowClamp = false}) => {

      const agentPulseDot = useFlag(HTPR_7339_AGENT_PULSE_DOT_FLAG)
      const agentMinute = useMinuteClock(Boolean(task.agentStatus))
      const agentStatusLine = task.agentStatus && agentStatusIsFresh(task.agentStatus.at, agentMinute)
        ? agentStatusText(
            task.agentStatus.agentName,
            agentStepFor(
              project?.sections?.find((section) => section.id === task.sectionId)?.section_title,
              (taskLabels ?? []).map((taskLabel) => taskLabel.label?.value ?? ""),
            ),
            task.agentStatus.at,
          )
        : null
      const calm = useFlag(HTPR_8970_CALM_CARDS_FLAG)
      const calmLabels = cardLabels(taskLabels ?? [], (taskLabel) => taskLabel.label?.value ?? "")
      const customFieldValues = (task as ITask & { customFieldValues?: CustomFieldValue[] }).customFieldValues


      const handleClick = async(modal:"Priority"|"Estimate"|"TaskLabels"|"DueDate"|"Assignees") => {
        updateTaskFocus(task)
        
        if (modal==="Assignees") setShowAssignModal(true)
        else if (modal==="Estimate") setShowEstimateModal(true)
        else if (modal==="Priority")  setShowPriorityModal(true)
        else if (modal==="TaskLabels") setShowCreateLabelModal(true)
        else if (modal==="DueDate") toggleDueDate()
      }
      
  const hasCustomFieldValues = (customFieldValues?.length ?? 0) > 0;

  return (

    (!calm && (agentStatusLine||agents.length>0))||blockingUser||(task.blockingTasks?.length ?? 0)>0||runningTimer||(showTimeTotals && (timeTotal?.totalSeconds ?? 0) > 0)||hasDraft||priority||estimate||dueDate||(calm ? calmLabels.shown.length>0 : (taskLabels&&taskLabels?.length>0))||hasCustomFieldValues?
    <div
      className={cn(
        cardOverflowClamp ? "basis-full flex min-w-0 max-w-full flex-wrap gap-1 overflow-x-hidden" : "basis-full flex gap-1 flex-wrap",
        calm && "[&_.label-pill]:!h-5 [&_.label-pill]:!min-h-5 [&_.label-pill]:!py-0 [&_.label-pill]:!px-1.5 [&_.label-pill]:!rounded-[4px] [&_.label-pill]:!text-micro [&_.label-pill]:!leading-4 [&_.label-pill_.lucide-calendar]:!size-3 [&>span]:!h-5 [&>span]:!leading-5",
      )}
    >
    {!calm && task.agentStatus && agentStatusLine && (
      agentPulseDot ? (
        <AgentStatusChip
          agentName={task.agentStatus.agentName}
          at={task.agentStatus.at}
          sectionTitle={project?.sections?.find((section) => section.id === task.sectionId)?.section_title}
          labelValues={(taskLabels ?? []).map((taskLabel) => taskLabel.label?.value ?? "")}
          pulseDot
          truncate
          className="min-w-0 max-w-full overflow-hidden"
        />
      ) : (
        <LabelWrapper title={agentStatusLine} className="min-w-0 max-w-full overflow-hidden" data-testid="agent-status-chip">
          <FaRobot className="h-3 w-3 shrink-0 text-icon-dark-gray" />
          <span className="min-w-0 truncate">{agentStatusLine}</span>
        </LabelWrapper>
      )
    )}
    {!calm && agents.map((agent) => (
      <AgentChip
        key={`agent-${agent.id}`}
        agent={agent}
        cardOverflowClamp={cardOverflowClamp}
        onClick={() => handleClick("Assignees")}
      />
    ))}
    {blockingUser && (cardOverflowClamp ? (
      <span className="inline-flex min-w-0 max-w-full overflow-hidden">
        <BlockerChip user={blockingUser} />
      </span>
    ) : (
      <BlockerChip user={blockingUser} />
    ))}
    {task.blockingTasks?.map((blockingTask) => (
      cardOverflowClamp ? (
        <span key={blockingTask.id} className="inline-flex min-w-0 max-w-full overflow-hidden">
          <BlockerTaskChip task={blockingTask} />
        </span>
      ) : (
        <BlockerTaskChip key={blockingTask.id} task={blockingTask} />
      )
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


          {calm ? (
            <>
              {calmLabels.shown.map((taskLabel) => (
                <TaskLabelComponent key={`Label-component-${taskLabel.id}`} stopPropogation={true} fontWeight={500}
                  onClick={() => handleClick("TaskLabels")} flexBasis={false} nowrap={cardOverflowClamp} labelValue={taskLabel.label?.value ?? ""} />
              ))}
              {calmLabels.more > 0 && (
                <span onClick={() => handleClick("TaskLabels")} className="opacity-60 cursor-pointer text-micro leading-5">
                  +{calmLabels.more}
                </span>
              )}
            </>
          ) : (() => {
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
                    nowrap={cardOverflowClamp}
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

          {hasCustomFieldValues && <CustomFieldChips projectId={task.projectId} values={customFieldValues} cardOverflowClamp={cardOverflowClamp} />}

    </div>
    :<></>
  )
}

type TCustomField = { id: string; name: string; type: CustomFieldType };
type CustomFieldValue = { fieldId: string; value: string; numericValue: number | null };

const AgentChip = ({
  agent,
  onClick,
  cardOverflowClamp,
}: {
  agent: IAgent;
  onClick: () => void;
  cardOverflowClamp: boolean;
}) => (
  <LabelWrapper
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    }}
    className={cardOverflowClamp ? "min-w-0 max-w-full cursor-pointer overflow-hidden" : "cursor-pointer"}
  >
    <FaRobot className="h-3 w-3 shrink-0 text-icon-dark-gray" />
    <span className={cardOverflowClamp ? "min-w-0 truncate" : "truncate"}>{agent.displayName}</span>
  </LabelWrapper>
);

const CustomFieldChips = ({
  projectId,
  values,
  cardOverflowClamp,
}: {
  projectId: number;
  values?: CustomFieldValue[];
  cardOverflowClamp: boolean;
}) => {
  const { data: customFields = [] } = useQuery<TCustomField[]>({
    queryKey: ["customFields", projectId],
    queryFn: async () => (await axios.get(`/api/customFields?projectId=${projectId}`)).data,
    enabled: !!projectId && (values?.length ?? 0) > 0,
  });

  if (!values?.length || !customFields.length) return null;

  const valueByFieldId = new Map(values.map((v) => [v.fieldId, v]));

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
          nowrap={cardOverflowClamp}
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
