import globalConstants from "@/lib/constants";
import { useRouter, usePathname } from "next/navigation";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import { REACT_QUERY_KEYS } from "@/lib/constants/constants";
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
  const router = useRouter();
  const pathname = usePathname();

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
  const navigateToTask = (projectId:number, taskUnqIdx:number, pushOrReplace:"push"|"replace"='push', additionalSQuery?:string) =>{
    const finalURL = `/detail/project-${projectId}/${taskUnqIdx}` + (additionalSQuery??"");
    const entryPath = taskDetailEntryPathForRoute(pathname);
    if (entryPath) markTaskDetailNavigationStart(entryPath, finalURL);
    pushOrReplace === "push" ? router.push(finalURL):router.replace(finalURL);
  }
  const queryClient = useQueryClient();
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
