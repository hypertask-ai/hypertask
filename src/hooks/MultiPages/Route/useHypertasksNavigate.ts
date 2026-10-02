import globalConstants from "@/lib/constants";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import { REACT_QUERY_KEYS } from "@/lib/constants/constants";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";
import { useAuth } from "@/hooks/General/useAuth";
import type { ITask } from "@/models/model";
import { useFlag } from "@/hooks/useFlag";
import { HTPR_6752_INSTANT_TICKET_OPEN_FLAG } from "@/lib/flags/keys";
import { openCachedTaskDetail } from "@/lib/navigation/cachedTaskDetail";
import {
  markTaskDetailNavigationStart,
  taskDetailEntryPathForRoute,
} from "@/lib/analytics/taskDetailReadiness";

type Pages =
  | "Reminders"
  | "Inbox"
  | "Inbox Archive"
  | "Task Archive"
  | "Trash"
  | "Back"
  | "Push"
  | "Replace"
  | "Refresh"
  | "All Tasks"
  | "My Tasks"
  | "Starred"
  | "Pinned"
  | "Drafts"
  | "Snippets"
  | "Scheduled"
  | "Calendar"
  | "Timers";

const useHypertasksNavigate = () => {
  const instantTicketOpen = useFlag(HTPR_6752_INSTANT_TICKET_OPEN_FLAG);
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const currentUser = useRecoilValue(currentUserAtom);
  const { authenticatedUserId } = useAuth();

  const navigateToReminders = () => router.push(`/reminders`);
  const navigateToInbox = (showAll: true) =>
    router.push(
      `${globalConstants.inboxRoute}${showAll ? "&showAll=true" : ""}`
    );
  const navigateToTaskArchived = () => router.push(`/archived`);
  const navigateToInboxArchived = () => router.push(`/archived?inbox=true`);
  const navigateToTrash = (projectId: number) =>
    router.push(`/trash/${projectId}`);
  const navigateBack = () => router.back();
  const navigateAndPush = (route: string) => router.push(route);
  const navigateToAllTasks = () => router.push(globalConstants.allTasksRoute);
  const navigateToMyTasks = () => router.push(globalConstants.myTasksRoute);
  const navigateToStarred = () => router.push(globalConstants.starredRoute);
  const navigateToPinned = () => router.push(globalConstants.pinnedRoute);
  const navigateToDrafts = () => router.push(globalConstants.draftsRoute);
  const navigateToSnippets = () => router.push(globalConstants.snippetsRoute);
  const navigateToTask = (projectId:number, taskUnqIdx:number, pushOrReplace:"push"|"replace"='push', additionalSQuery?:string, task?: ITask) =>{
    const finalURL = `/detail/project-${projectId}/${taskUnqIdx}` + (additionalSQuery??"");
    const entryPath = taskDetailEntryPathForRoute(pathname);
    if (entryPath) markTaskDetailNavigationStart(entryPath, finalURL);
    if (instantTicketOpen && currentUser?.id && authenticatedUserId === currentUser.id) {
      if (openCachedTaskDetail({
        queryClient, accountId: currentUser.id, projectId, uniqueIndex: taskUnqIdx,
        href: finalURL, replace: pushOrReplace === "replace", task,
      })) return;
    }
    pushOrReplace === "push" ? router.push(finalURL):router.replace(finalURL);
  }
  const navigate = (page: Pages, payload?: any) => {
    const uploadInProgress = queryClient.getQueryData(
      REACT_QUERY_KEYS.uploadStates
    );
    if (uploadInProgress && pathname?.startsWith("/detail")) {
      toast("Upload in progress!");
      return;
    }
    switch (page) {
      case "Reminders":
        navigateToReminders();
        break;
      case "Inbox":
        navigateToInbox(payload);
        break;
      case "Inbox Archive":
        navigateToInboxArchived();
        break;
      case "Task Archive":
        navigateToTaskArchived();
        break;
      case "All Tasks":
        navigateToAllTasks();
        break;
      case "My Tasks":
        navigateToMyTasks();
        break;
      case "Trash":
        navigateToTrash(payload);
        break;
      case "Starred":
        navigateToStarred();
        break;
      case "Pinned":
        navigateToPinned();
        break;
      case "Drafts":
        navigateToDrafts();
        break;
      case "Snippets":
        navigateToSnippets();
        break;
      case "Back":
        navigateBack();
        break;
      case "Push":
        navigateAndPush(payload);
        break;
      case "Replace":
        router.replace(payload);
        break;
      case "Scheduled":
        router.push("/scheduled");
        break;
      case "Calendar":
        router.push("/calendar")
        break;
      case "Timers":
        router.push(globalConstants.timersRoute);
        break;
      case "Refresh":
        router.refresh();
        break;
    }
  };

  return { navigate, navigateToTask };
};

export default useHypertasksNavigate;
