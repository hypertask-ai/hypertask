import globalConstants from "@/lib/constants";
import { IComment, IDraft, IProject, ITask, IUser } from "@/models/model";
import { activeItemAtom, currentUserAtom, inViewObjectAtom, lastUsedBoardsAtom } from "@/store";
import { buildProjectSurfaceUrl, getViewFromProject } from "@/utils/helperFunctions/Views/ViewsHelperFunctions";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import nookies from "nookies";
import {
  useRecoilValue,
  useResetRecoilState,
  useSetRecoilState,
} from "@/lib/state";

export const useProjectQuery = () => {
  const queryClient = useQueryClient();
  const currentUser = useRecoilValue(currentUserAtom);
  const setActiveItem = useSetRecoilState(activeItemAtom);
  const setInViewObject = useSetRecoilState(inViewObjectAtom);
  const resetActiveItem = useResetRecoilState(activeItemAtom);
  const resetInViewObject = useResetRecoilState(inViewObjectAtom);
  const setLastUsedBoards = useSetRecoilState(lastUsedBoardsAtom);
  const router = useRouter();
  const hyperAI: IUser | undefined = queryClient.getQueryData(["hyper-ai"]);

  const updateActiveItemAndItemInView = (task: ITask | null) => {
    if (task === null) {
      resetActiveItem();
      resetInViewObject();
    } else {
      setActiveItem(task.id);
      setInViewObject({
        taskId: task.id,
        taskProjectId: task?.projectId ?? null,
        sectionId: task?.sectionId ?? null,
        taskTicketNumber: task?.ticketNumber ?? null,
        sectionTitle: task?.section ?? null,
        taskTitle: task?.title ?? null,
      });
    }
  };

  const goToProjectShortcut = (
    projectId: number,
    updateBoardCookie: boolean = false,
    updateSearchParamsOnly: boolean = false,
    surface?: "board" | "table",
    shallow: boolean = false,
  ) => {
    // Track board usage
    setLastUsedBoards((prev) => ({
      ...prev,
      [projectId]: Date.now(),
    }));

    const allProjects: IProject[] =
      queryClient.getQueryData(["projectsAllMinimal"]) ?? [];
    const project = allProjects.filter(
      (item: IProject) => item.id === projectId
    );
    const activeView = getViewFromProject(project[0]);

    if (updateBoardCookie) {
      nookies.destroy(null, "previousBoard");
      const cookieValue =
        activeView && activeView.type === "Applied"
          ? `project-${projectId}|&|${activeView.view.slug}`
          : `project-${projectId}|&|${undefined}`;
      nookies.set(null, "previousBoard", cookieValue, {
        maxAge: 600 * 60 * 24 * 7,
        path: "/",
      });
    }

    const destination = buildProjectSurfaceUrl({
      projectId,
      viewSlug:
        activeView?.type === "Applied" ? activeView.view.slug : undefined,
      surface,
    });

    // Only update search params without navigation
    if (updateSearchParamsOnly) {
      router.replace(destination);
      return;
    }

    // HTPR-6072: the sidebar board switcher goes shallow - pushState updates
    // the URL and next/navigation's useSearchParams picks it up immediately,
    // without the server round trip router.push triggers (which remounts
    // LandingPage on every switch). Only the sidebar switcher passes
    // shallow=true; every other caller (task detail, calendar, command
    // palette, etc.) keeps the full navigation, including its server-side
    // access gate.
    if (shallow) {
      window.history.pushState(null, "", destination);
      return;
    }

    // Normal navigation behavior
    router.push(destination);
  };

  const resetDescriptionQuery = async (taskId: number, userId: number) => {
    const draftQueryKey = ["draft for [task,userId]:", taskId, userId];
    const getDraft: IDraft[] = await queryClient.getQueryData(draftQueryKey) ?? [];

    const updatedDraft = getDraft?.filter(
      (draft: IDraft) => draft?.type !== "Description"
    ) ?? [];
    queryClient.setQueryData(draftQueryKey, updatedDraft);
  };

  const updateCommentsActivityQuery = (
    comments: IComment[],
    newComment: IComment,
    taskId: number,
    setCommentsHandler: (comments: IComment[]) => void
  ) => {
    const updatedComments: any[] = [
      ...comments,
      {
        ...newComment,
        text: "", // Consider providing a meaningful text or removing this field if not needed
        taskId,
        activity: {
          type: newComment.activity?.type,
          data: {
            ...newComment.activity?.data,
          },
        },
        creator: {
          displayName: currentUser.displayName,
          photoURL: currentUser.photoURL,
          id: currentUser.id,
        },
        createdAt: new Date(),
      },
    ];
    const stack_: any = queryClient.getQueryData([
      globalConstants.CommentStackStatusKey,
    ]);
    const newInitialMap: any = {};
    updatedComments.slice(0, -1).map((item: IComment, index: number) => {
      newInitialMap[index] = item.seen?.includes(currentUser.id)
        ? stack_?.stack
        : false;
    });
    setCommentsHandler(updatedComments);
    queryClient.setQueryData(
      [globalConstants.CommentsTQPrefixKey, taskId],
      (prev: any) => ({
        comments: updatedComments,
        stacked: newInitialMap,
      })
    );
  };

  return {
    goToProjectShortcut,
    resetDescriptionQuery,
    updateCommentsActivityQuery,
    updateActiveItemAndItemInView,
    hyperAI,
  };
};
