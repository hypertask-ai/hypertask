import { useContext } from "react";
import { GitMerge, GitPullRequest } from "lucide-react";
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import {
  LocalRightSideInfo,
  TaskInfoColumnContainer,
  TaskInfoLabel,
  TaskInfoRow,
  TaskInfoValue,
} from "@/components/PageComponents/TaskDetail/MainPageComponents";
import type { ITaskPullRequest } from "@/models/model";
import type { ITaskInfoContainer } from "./TaskInfo";
import RelatedTaskLabel from "./RelatedTaskLabel";
import { derivePullRequestDisplayState } from "@/lib/pullRequests/githubPullRequests";
import { pullRequestBadgeByState } from "@/components/PageComponents/TaskDetail/pullRequestBadge";

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
// Uncached PRs and relations grow below the painted properties; on mobile they
// belong below the thread, not above the already-visible description.
export function TaskInfoLateDetails({ currentTask, removeRelationHandler }: Pick<ITaskInfoContainer, "currentTask" | "removeRelationHandler">) {
  const mobile = useContext(MobileViewContext);
  if (!currentTask.pullRequests?.length && !currentTask.relatedFromTasks?.length && !currentTask.relatedToTasks?.length) return null;
  const content = <>
    <PullRequestRows pullRequests={currentTask.pullRequests ?? []} />
    <TaskRelations currentTask={currentTask} removeRelationHandler={removeRelationHandler} />
  </>;
  return mobile ? <TaskInfoColumnContainer heightVariant="fit">{content}</TaskInfoColumnContainer> : content;
}

export function PullRequestRows({ pullRequests }: { pullRequests: ITaskPullRequest[] }) {
  return (
    <>
      {pullRequests.length > 0 && (
        <TaskInfoRow alignTop>
          <TaskInfoLabel>Pull requests</TaskInfoLabel>
          <TaskInfoValue className="flex min-w-0 flex-col gap-1 overflow-hidden">
            {pullRequests.map((pullRequest) => {
              const displayState = derivePullRequestDisplayState(
                pullRequest.lifecycle,
                pullRequest.checkState
              );
              const badge = pullRequestBadgeByState[displayState];
              const PullRequestIcon =
                displayState === "merged" ? GitMerge : GitPullRequest;
              return (
                <a
                  key={pullRequest.id}
                  href={pullRequest.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full max-w-full min-w-0 items-center gap-1.5 overflow-hidden py-0.5"
                  title={pullRequest.title}
                >
                  <PullRequestIcon
                    size={14}
                    strokeWidth={1.8}
                    className="shrink-0"
                    style={{ color: badge.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-white-black hover:underline">
                    #{pullRequest.number} {pullRequest.repositoryName}
                  </span>
                  <span
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold leading-none"
                    style={{ color: badge.color }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: badge.color }}
                    />
                    {badge.label}
                  </span>
                </a>
              );
            })}
          </TaskInfoValue>
        </TaskInfoRow>
      )}
    </>
  );
}

export function TaskRelations({ currentTask, removeRelationHandler }: Pick<ITaskInfoContainer, "currentTask" | "removeRelationHandler">) {
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
    <>
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
    </>
  );
}
