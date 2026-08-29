"use client";

import { useQuery } from "@tanstack/react-query";
import type { RefObject } from "react";

import TaskDetail from "@/app/detail/[...slug]/TaskDetailComp";
import { useGetUserPreferences } from "@/hooks/General/useGetUserPreferences";
import globalConstants from "@/lib/constants";
import { FollowersProvider } from "@/lib/contexts/TaskDetail/FollowersProvider";
import { TasksProvider } from "@/lib/contexts/TaskDetail/TaskProvider";
import { useRecoilValue } from "@/lib/state";
import type { ITask } from "@/models/model";
import { currentUserAtom } from "@/store";
import { fetchCommentsHelper } from "@/utils/api/Task Detail";

type EmbeddedTaskDetailProps = {
  taskId: number;
  projectId: number;
  uniqueIndex: number;
  scrollElementRef: RefObject<HTMLDivElement | null>;
};

const fetchTaskDetail = async (projectId: number, uniqueIndex: number) => {
  const response = await fetch(
    `/api/tasks/getTask?project=project-${projectId}&uniqueIndex=${uniqueIndex}`,
  );
  if (!response.ok) throw new Error("Unable to load task");
  const task = (await response.json()) as ITask | null;
  if (!task) throw new Error("Unable to load task");
  return task;
};

const EmbeddedTaskDetail = ({
  taskId,
  projectId,
  uniqueIndex,
  scrollElementRef,
}: EmbeddedTaskDetailProps) => {
  const currentUser = useRecoilValue(currentUserAtom);
  const { data: preferences } = useGetUserPreferences();
  const taskQuery = useQuery({
    queryKey: ["swipe-unread-task-detail", taskId],
    queryFn: () => fetchTaskDetail(projectId, uniqueIndex),
  });
  const commentsQuery = useQuery({
    queryKey: [globalConstants.CommentsTQPrefixKey, taskId],
    queryFn: () => fetchCommentsHelper(taskId, currentUser.id),
    enabled: Boolean(currentUser?.id),
  });

  if (taskQuery.isError || commentsQuery.isError) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 text-content text-text-light-gray">
        Unable to load this task
      </div>
    );
  }

  const task = taskQuery.data;
  const comments = commentsQuery.data;
  if (!task || !comments || !currentUser?.id) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 text-content text-text-light-gray">
        Loading task…
      </div>
    );
  }

  const serializedTask = JSON.stringify(task);
  const serializedComments = JSON.stringify(comments);
  const slugs = [`project-${projectId}`, String(uniqueIndex)];

  return (
    <TasksProvider
      key={`swipe-unread-task-provider-${taskId}`}
      stack={{ stack: preferences.commentsStacked }}
      _initialStacked={comments.stacked}
      _comments={serializedComments}
      allowPerks
      parsedTask={serializedTask}
      scrollSetting={preferences.scrollSetting}
      embedded
      scrollElementRef={scrollElementRef}
    >
      <FollowersProvider>
        <TaskDetail
          key={`swipe-unread-task-detail-${taskId}`}
          allowPerks
          isMobile={false}
          _currentUser={currentUser}
          _currentTask={serializedTask}
          _comments={serializedComments}
          _slugs={slugs}
          embedded
        />
      </FollowersProvider>
    </TasksProvider>
  );
};

export default EmbeddedTaskDetail;
