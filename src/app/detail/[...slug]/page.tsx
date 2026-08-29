import TaskDetail from "./TaskDetailComp";
import {
  fetchCommentsForSlug,
  fetchTaskDetail,
  parseDetailSlug,
  parseProjectSlug,
} from "@/utils/controllers/taskDetail/load";
import { Metadata } from "next";
import { requireServerCookieUser } from "@/lib/auth/serverUser";


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


export async function generateMetadata(props: any): Promise<Metadata> {
  const params = await props.params;
  // read route params
  if (!parseDetailSlug(params.slug)) return { title: "Hypertask" }
  params.slug[0], params.slug[1]
  console.log("🚀 ~ params.slug[1]:", params.slug[1])
  // fetch data
  const task = await prisma.task.findFirst({
    where: {
      uniqueIndex: parseInt(params.slug[1]),
      project: {
        id: parseInt(params.slug[0].split('-')[1]),
      }
    },
    select: { title: true, ticketNumber: true }
  })

  const tabTitle = task?.ticketNumber + " " + task?.title + " - Hypertask"
  return {
    title: tabTitle,

  }
}

export default async function Page(
  props: {
    // slug is a catch-all segment, so it is a string[] — it was typed `string`,
    // which typechecks by accident because indexing a string yields characters.
    params: Promise<{
      any: any; slug: string[]
    }>;
    searchParams: Promise<any>
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;

  // No ticket number in the URL: send them to the board rather than query for
  // task NaN, which Prisma rejects outright (HTPR-4838). Done before any other
  // await so nothing has started streaming.
  const detailSlug = parseDetailSlug(params.slug);
  if (!detailSlug) {
    const projectId = parseProjectSlug(params.slug?.[0] ?? "");
    redirect(Number.isInteger(projectId) ? `/project?id=${projectId}` : "/");
  }

  console.log(params)
  // const _user = getCookie("user")
  const userObj = await requireServerCookieUser();
  var initialMap: any = {};
  var comments: any[] | any = [];
  let allowPerks = false;
  let task: any;
  const currentDate = new Date()
  let lastReadAt: Date | null = null;

  // Extract and parse hash
  let stack = false;
  let scrollSetting = "Bottom" as ScrollSetting;

  console.time(`🤔 ~ TDP Fetch for ${params.slug[0]}/${params.slug[1]}`)
  const slug = detailSlug;

  const [taskResult, commentsJson, userPreferences] = await Promise.all([
    fetchTaskDetail(params.slug[0], params.slug[1], userObj.id),
    fetchCommentsForSlug(slug, userObj.id),
    fetchUserPreferenceController(userObj.id),
  ]);

  task = taskResult;
  if (!task) {
    redirect("/unauthorized");
  }

  lastReadAt = await getTaskReadStateLastReadAt(task.id, userObj.id);
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

    console.timeEnd(`🤔 ~ TDP Fetch for ${params.slug[0]}/${params.slug[1]}`)
  }

  // Call the function to fetch sections for all projects and update them
  return (
    <>
      <TasksProvider
        key={`task-detail-page-tasks-provider-${task.id}`}
        stack={{ stack }}
        _initialStacked={initialMap}
        _comments={JSON.stringify({ comments: comments.json, stacked: initialMap, lastReadAt })}
        allowPerks={true}
        parsedTask={JSON.stringify(task)}
        scrollSetting={scrollSetting}
      >
        <FollowersProvider>
          <Suspense fallback={<>Loading...</>}>

            <TaskDetail
              key={`task-detail-page-container-${task.id}`}
              allowPerks={true}
              isMobile={false}
              _currentUser={userObj}
              _currentTask={JSON.stringify(task)}
              _comments={JSON.stringify({ comments: comments.json, stacked: initialMap, lastReadAt })}
              _slugs={[params.slug[0], params.slug[1]]}
            />
          </Suspense>
        </FollowersProvider>
      </TasksProvider>
    </>
  )
}
