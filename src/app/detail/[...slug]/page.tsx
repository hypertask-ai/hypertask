import TaskDetail from "./TaskDetailComp";
import {
  fetchCommentsForSlug,
  fetchTaskDetail,
  findTaskNumberAlias,
  findTaskByTicketNumber,
  parseDetailSlug,
  parseProjectSlug,
} from "@/utils/controllers/taskDetail/load";
import { Metadata } from "next";
import { getServerCookieUser, requireServerCookieUser } from "@/lib/auth/serverUser";
import { projectContentAccessWhere } from "@/utils/controllers/projects/getAllIncludes";
import { HTPR_6868_TICKET_PREFIX_FLAG, HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG, isFeatureEnabled } from "@/lib/flags";


import { redirect } from "next/navigation";
import { Suspense } from "react";
import prisma from "@/lib/prisma";
import { TasksProvider } from "@/lib/contexts/TaskDetail/TaskProvider";
import { FollowersProvider } from "@/lib/contexts/TaskDetail/FollowersProvider";

import { processComments } from "@/utils/helperFunctions/TaskDetail";
import { fetchUserPreferenceController } from "@/utils/controllers/users/fetch_preferences";
import { ScrollSetting } from "@prisma/client";
import { getTaskReadStateLastReadAt } from "@/utils/controllers/tasks/markRead";
import { filterCommentReadReceipts } from "@/utils/controllers/comments/readReceipts";
import { listTaskAgentRunActivities } from "@/lib/agentRuns/service";
import Unauthorized from "../../unauthorized/page";


export async function generateMetadata(props: any): Promise<Metadata> {
  const params = await props.params;
  const slug = parseDetailSlug(params.slug);
  if (!slug) return { title: "Hypertask" };
  const user = await getServerCookieUser();
  if (!user) return { title: "Hypertask" };
  const task = await prisma.task.findFirst({
    where: {
      ...slug,
      project: projectContentAccessWhere(user.id),
    },
    select: { title: true, ticketNumber: true }
  });
  if (!task) return { title: "Hypertask" };

  const tabTitle = task.ticketNumber + " " + task.title + " - Hypertask"
  return {
    title: tabTitle,

  }
}

export default async function Page(
  props: {
    params: Promise<{
      any: any; slug: string[]
    }>;
    searchParams: Promise<any>
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  if (/^[A-Za-z0-9][A-Za-z0-9_-]*-\d+$/.test(params.slug?.[1] ?? "")) {
    const user = await requireServerCookieUser();
    if (await isFeatureEnabled(HTPR_6868_TICKET_PREFIX_FLAG, user.id)) {
      const task = await findTaskByTicketNumber(params.slug[1], user.id, parseProjectSlug(params.slug[0]));
      if (!task) return <Unauthorized />;
      redirect(`/detail/project-${task.projectId}/${task.uniqueIndex}`);
    }
  }
  const detailSlug = parseDetailSlug(params.slug);
  if (!detailSlug) {
    const projectId = parseProjectSlug(params.slug?.[0] ?? "");
    redirect(Number.isInteger(projectId) ? `/project?id=${projectId}` : "/");
  }

  console.log(params)
  const userObj = await requireServerCookieUser();
  var initialMap: any = {};
  var comments: any[] | any = [];
  let allowPerks = false;
  let task: any;
  const currentDate = new Date()
  let lastReadAt: Date | null = null;
  let agentRunActivities: Awaited<ReturnType<typeof listTaskAgentRunActivities>> = [];

  let stack = false;
  let scrollSetting = "Bottom" as ScrollSetting;

  const slug = detailSlug;

  const commentsUpdatedAt = currentDate.getTime();
  const [taskResult, commentsJson, userPreferences, descriptionFirst] = await Promise.all([
    fetchTaskDetail(params.slug[0], params.slug[1], userObj.id),
    fetchCommentsForSlug(slug, userObj.id),
    fetchUserPreferenceController(userObj.id),
    isFeatureEnabled(HTPR_7367_SERVER_DESCRIPTION_FIRST_FLAG, userObj.id).catch(() => false),
  ]);

  task = taskResult;
  if (!task) {
    const currentTask = await findTaskNumberAlias(slug, userObj.id);
    if (currentTask) {
      redirect(`/detail/project-${currentTask.projectId}/${currentTask.uniqueIndex}`);
    }
    return <Unauthorized />;
  }

  [lastReadAt, agentRunActivities] = await Promise.all([
    getTaskReadStateLastReadAt(task.id, userObj.id),
    listTaskAgentRunActivities(userObj.id, task.id).catch((error) => {
      console.error("[agent-run] task activity load failed", error);
      return [];
    }),
  ]);
  allowPerks = task.project?.team.activeSubscriptionPlanId ? true : false;
  if (!Array.isArray(task) && task) {
    const {
      commentsStacked,
      scrollSetting: userScrollSetting,
      shareReadReceipts,
    } = userPreferences.res;
    stack = commentsStacked;
    scrollSetting = userScrollSetting as ScrollSetting;
    const hash = searchParams.hash || "";

    initialMap = processComments(
      commentsJson,
      userObj.id,
      stack,
      hash
    );
    comments = {
      status: 200,
      json: await filterCommentReadReceipts(
        commentsJson,
        userObj.id,
        shareReadReceipts,
      ),
    };
  }

  return (
    <>
      <TasksProvider
        key={`task-detail-page-tasks-provider-${task.id}`}
        stack={{ stack }}
        _initialStacked={initialMap}
        _comments={JSON.stringify({ comments: comments.json, stacked: initialMap, lastReadAt, agentRunActivities, updatedAt: commentsUpdatedAt })}
        allowPerks={true}
        parsedTask={JSON.stringify(task)}
        serverTaskSeed={{ userId: userObj.id, taskId: task.id, projectId: slug.projectId, uniqueIndex: slug.uniqueIndex, updatedAt: currentDate.getTime() }}
        scrollSetting={scrollSetting}
        descriptionStart={descriptionFirst ? "server" : "live"}
      >
        <Suspense fallback={<>Loading...</>}>
          <FollowersProvider>
            <TaskDetail
              key={`task-detail-page-container-${task.id}`}
              allowPerks={true}
              isMobile={false}
              _currentUser={userObj}
              _slugs={[params.slug[0], params.slug[1]]}
            />
          </FollowersProvider>
        </Suspense>
      </TasksProvider>
    </>
  )
}
