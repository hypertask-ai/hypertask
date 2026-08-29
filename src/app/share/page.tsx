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
        },
      },
    },
  });
  const tabTitle =
    taskInfo?.task.ticketNumber + " " + taskInfo?.task?.title + " - Hypertask";
  return {
    title: tabTitle,
    robots: "noindex, nofollow",
    // Tell Google/Chrome not to offer page translation. Chrome Translate wraps
    // translated text in <font> tags before React hydrates, which is a
    // recurring React #418 hydration failure on public share links (HTPR-4980).
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
  if (!sharedTask || sharedTask.task.status === "Deleted") {
    redirect("/unauthorized");
  }

  if (userObjString) {
    // cookies().get() returns the raw url-encoded value; decode before parsing.
    // A malformed cookie must not crash the share page for logged-in users:
    // fall back to the public (logged-out) view instead.
    try {
      user = JSON.parse(decodeURIComponent(userObjString.value));
    } catch {
      user = undefined;
    }
  }

  if (user) {
    checkBoardMember = await checkIfBoardMember(user.id, sharedTask.projectId);
    if (checkBoardMember === 200) {
      //show view/edit option or just redirect to task page.
      //for now lets redirect to task page
      return redirect(`/detail/project-${task.projectId}/${task.uniqueIndex}`);
    } else if (checkBoardMember === 201) {
      //show join button instead of login button
    } else {
      redirect("/unauthorized");
    }
  }

  if (!Array.isArray(task) && task) {
    comments = await getSharedComments(task?.id?.toString());
    initialMap = processSharedComments(comments.json || []);
  }

  let shouldBlur: boolean = false;
  if (sharedTask.shareType === "Domain") {
    if (user === undefined) shouldBlur = true;
    else {
      if (checkBoardMember === 201) shouldBlur = true;
    }
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
        {/* translate="no" keeps Chrome Translate out of the hydrated subtree:
            it rewrites text nodes into <font> elements pre-hydration and React
            throws #418 on every visit for that visitor (HTPR-4980). */}
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
                <div
                  className={`${
                    shouldBlur ? "blur-sm pointer-events-none" : ""
                  }`}
                >
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
