import { cookies } from "next/headers";
import { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import prisma from "@/lib/prisma";
import { TasksProvider } from "@/lib/contexts/TaskDetail/TaskProvider";
import { FollowersProvider } from "@/lib/contexts/TaskDetail/FollowersProvider";
import {
  checkIfBoardMember,
  getSharedComments,
  getSharedTaskInfo,
  isShareLinkLive,
  processSharedComments,
} from "@/utils/controllers/tasks/getSharedTask";
import SharedTaskDetailComp from "./SharedTaskDetailComp";
import SharedTaskPageFooter from "@/components/PageComponents/TaskDetail/SharedTask/Footer/Footer";
import { IUser } from "@/models/model";

export async function generateMetadata(props: any): Promise<Metadata> {
  const searchParams = await props.searchParams;
  const shareId = searchParams?.id;
  if (!shareId) {
    return { title: "Shared Task - Hypertask", robots: "noindex, nofollow", other: { google: "notranslate" } };
  }
  const taskInfo = await prisma.taskSharing.findUnique({
    where: {
      id: shareId,
    },
    include: {
      task: {
        select: {
          ticketNumber: true,
          title: true,
          status: true,
        },
      },
    },
  });
  const tabTitle =
    taskInfo && taskInfo.shareType !== "Domain" && isShareLinkLive(taskInfo)
      ? taskInfo.task.ticketNumber + " " + taskInfo.task.title + " - Hypertask"
      : "Shared Task - Hypertask";
  return {
    title: tabTitle,
    robots: "noindex, nofollow",
    other: { google: "notranslate" },
  };
}

export default async function Page(
  props: {
    params: Promise<any>;
    searchParams: Promise<any>;
  }
) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  let userObjString: any = cookieStore.get("nookies_user");

  var initialMap: any = {};
  var comments: any[] | any = [];
  let task: any;
  let checkBoardMember: undefined | 200 | 201 | 400;
  const shareId = searchParams?.id;
  if (!shareId) redirect("/unauthorized");
  const sharedTask = await getSharedTaskInfo(shareId);
  let user: IUser | undefined;
  task = sharedTask?.task;
  if (!sharedTask || !isShareLinkLive(sharedTask)) {
    redirect("/unauthorized");
  }

  if (userObjString) {
    try {
      user = JSON.parse(decodeURIComponent(userObjString.value));
    } catch {
      user = undefined;
    }
  }

  if (user) {
    checkBoardMember = await checkIfBoardMember(user.id, sharedTask.projectId);
    if (checkBoardMember === 200) {
      return redirect(`/detail/project-${task.projectId}/${task.uniqueIndex}`);
    } else if (checkBoardMember === 201) {
    } else {
      redirect("/unauthorized");
    }
  }

  if (sharedTask.shareType === "Domain") {
    return (
      <SharedTaskPageFooter
        shareType={sharedTask.shareType}
        shareId={sharedTask.id}
        sharedUserEmail={sharedTask.user.email}
        checkBoardMember={checkBoardMember}
        user={user}
      >
        <main translate="no" />
      </SharedTaskPageFooter>
    );
  }

  if (!Array.isArray(task) && task) {
    comments = await getSharedComments(task?.id?.toString());
    initialMap = processSharedComments(comments.json || []);
  }

  return (
    <>
      <SharedTaskPageFooter
        shareType={sharedTask.shareType}
        shareId={sharedTask.id}
        sharedUserEmail={sharedTask.user.email}
        checkBoardMember={checkBoardMember}
        user={user}
      >
        <main translate="no">
          <Suspense fallback={<>Loading...</>}>
            <TasksProvider
              key={`task-detail-page-tasks-provider-${task.id}`}
              stack={{ stack: false }}
              _initialStacked={initialMap}
              _comments={JSON.stringify({
                comments: comments.json,
                stacked: initialMap,
              })}
              allowPerks={true}
              parsedTask={JSON.stringify(task)}
              scrollSetting={"None"}
              isShareView
            >
              <FollowersProvider>
                <div>
                  <SharedTaskDetailComp
                    key={`task-detail-page-container-${task.id}`}
                    _slugs={[
                      sharedTask.task.project.name,
                      sharedTask.task.uniqueIndex.toString(),
                    ]}
                  />
                </div>
              </FollowersProvider>
            </TasksProvider>
          </Suspense>
        </main>
      </SharedTaskPageFooter>
    </>
  );
}
