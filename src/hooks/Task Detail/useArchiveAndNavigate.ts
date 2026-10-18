import { useTaskContext } from '@/lib/contexts/TaskDetail/TaskProvider';
import  {useContext, useCallback} from 'react'
import UpdateKanban from '../MultiPages/useUpdateTaskInBoards';
import useGlobalFocusHandler, { type INotificationsFromTQ } from '../Inbox/useGlobalFocusHandler';
import { useRecoilState } from '@/lib/state';
import { currentUserAtom, tasksPlayListAtom } from '@/store';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useUndoContext } from '../General/useUndo';
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useHypertasksNavigate from '../MultiPages/Route/useHypertasksNavigate';
import { useSearchParams } from 'next/navigation';
import { useFlag } from '@/hooks/useFlag';
import { HTPR_7002_INBOX_E_FIRST_PRESS_FLAG } from '@/lib/flags/keys';
import { inboxDataQueryKey } from '../Inbox/useGetNotifications';
import {
  nextRemainingInboxTask,
  resolveTaskPlaylistNavigation,
  shouldApplyLocalArchivedStatus,
  type TaskArchiveNavigationOutcome,
} from '@/lib/taskDetailArchiveNavigation';

const useArchiveAndNavigate = () => {
  const inboxEFirstPress = useFlag(HTPR_7002_INBOX_E_FIRST_PRESS_FLAG);
  const queryClient = useQueryClient();
  const { undoAction} = useUndoContext();
  const _mbl = useContext(MobileViewContext);

  const {  currentItemInTasksPlaylist, onGoback, setCurrentTask, currentTask} = useTaskContext();

  const {removeFromListWithStatus}=UpdateKanban();
  const {moveIdxDown, moveIdxUp, archiveNotificationGetter} = useGlobalFocusHandler()
  const [tasksPlayList, setTasksPlaylist] = useRecoilState(tasksPlayListAtom);
  const [currentUser,_setCurrentUser] = useRecoilState(currentUserAtom);
  const {navigate} =useHypertasksNavigate()
  const searchParams = useSearchParams()

const setNotificationCountNull = (undo?:boolean)=> {
   // @ts-expect-error Spreading a nullable task produces optional required ITask fields.
   setCurrentTask((old) => ({
    ...old,
    _count:{
      notifications:undo?1:0
    }
  }));
}
const navigateToNextTask = (archiveNotification?:boolean,shouldNavigate?:boolean, remindMe?:boolean, force?:"forceNavigate", inboxFlow?:string|null): TaskArchiveNavigationOutcome=>{
  const indexOf = tasksPlayList?.findIndex(obj =>obj.projectId === currentItemInTasksPlaylist.projectId && obj.uniqueIndex === currentItemInTasksPlaylist.uniqueIndex);
  const activeInboxFlow = inboxFlow ?? searchParams?.get("inboxFlow")
  const earlyInboxMembership = inboxEFirstPress && archiveNotification && activeInboxFlow === "true" &&
    currentTask?._count?.notifications === undefined
  const inInbox = earlyInboxMembership
    ? queryClient.getQueryData<INotificationsFromTQ>(inboxDataQueryKey(currentUser.id))?.notifications.find(notification =>
        notification.taskId === currentTask?.id && notification.projectId === currentTask?.projectId &&
        notification.userId === currentUser.id && notification.status === "Normal" &&
        !notification.waitingOnSynthetic && Number.isSafeInteger(Number(notification.id)) && Number(notification.id) > 0)
    : currentTask?.notifications&&currentTask?.notifications[0]
  const missingInboxTarget = activeInboxFlow && indexOf === -1 && tasksPlayList
    ? nextRemainingInboxTask(tasksPlayList, currentItemInTasksPlaylist)
    : undefined


  if (archiveNotification && currentTask){

    if (!(earlyInboxMembership ? inInbox : currentTask._count?.notifications)){
      console.log("🚀 ~ navigateToNextTask ~ currentTask:", currentTask)
      if (force==="forceNavigate") moveIdxDown()
      else{
        setNotificationCountNull()
        toast("This task is not in inbox")
        return "stayed"
      }
    } 
         
    if(inInbox){
       undoInboxArchive({notification:inInbox, currentUser:currentUser}, remindMe)
      if(!shouldNavigate) navigate('Refresh')
      }
  }
  else  moveIdxDown()

  if (!shouldNavigate)return "stayed"
  const hasPlaylist = !!(currentTask&&currentTask.projectId&&tasksPlayList&&tasksPlayList.length>0)
  const playlistTarget = hasPlaylist
    ? resolveTaskPlaylistNavigation({
        indexOf: indexOf!,
        playlistLength: tasksPlayList!.length,
        remindMe,
        inboxFlow: Boolean(activeInboxFlow),
        hasNextInboxTask: Boolean(missingInboxTarget),
      })
    : "back"

  if (playlistTarget === "back") {
    onGoback()
    return "navigated"
  }
  if (playlistTarget === "next") {
    const nextTask = indexOf === -1
      ? missingInboxTarget
      : tasksPlayList![indexOf!+1]
    if (!nextTask) {
      onGoback()
      return "navigated"
    }
    const inboxParam=activeInboxFlow?'?inboxFlow=true':''
    navigate("Replace",`/detail/project-${nextTask.projectId}/${nextTask.uniqueIndex}${inboxParam}`)
    return "navigated"
  }
  return "stayed"
}

const navigateToPreviousTask = useCallback((isUndoClicked:boolean, isUndo:boolean, inboxFlow?: string | null)=>{

  if (currentTask&&currentTask.projectId&&tasksPlayList&&tasksPlayList.length>0){
    const indexOf = tasksPlayList.findIndex(obj =>obj.projectId === currentItemInTasksPlaylist.projectId && obj.uniqueIndex === currentItemInTasksPlaylist.uniqueIndex);
    const indexToGoTo = isUndoClicked?indexOf:indexOf-1
    const taskToGoTo = tasksPlayList[indexToGoTo]
    if (!taskToGoTo) return
    const inboxParam=inboxFlow?'?inboxFlow=true':''
    const URL = `/detail/project-${taskToGoTo.projectId}/${taskToGoTo.uniqueIndex}${inboxParam}`
    navigate("Replace",URL)

    if (isUndoClicked) moveIdxUp()
    

   
    else if (indexOf <= 0 || isUndo && indexOf===tasksPlayList.length-1 ) {
    } else {
      moveIdxUp()

    }
  }
},[currentItemInTasksPlaylist.projectId, currentItemInTasksPlaylist.uniqueIndex, currentTask, moveIdxUp, navigate, tasksPlayList])

  const markAsDone = async (forceNavigate?:boolean) => {
    if (!currentTask) return;
    const isUnarchiving = currentTask.status === "Archive";
    const hasUndo = await removeFromListWithStatus(
      currentTask.sectionId,
      currentTask.projectId,
      currentTask.id,
      isUnarchiving ? "Normal" : "Archive",
      undefined,
      {
        undoRedirectPath: isUnarchiving
          ? undefined
          : `/detail/project-${currentTask.projectId}/${currentTask.uniqueIndex}`,
      },
    )
    if (isUnarchiving) {
      setCurrentTask((old) =>
        old
          ? {
              ...old,
              _count: { notifications: 1 },
              status: "Normal",
            }
          : old,
      );
    }
    const toastMessage = currentTask.status === "Archive" ? "Task was unmarked as done" : "Task was marked as done"
    const toastMessageNavigation = currentTask.status === "Archive" ? "Go to Home Page" : "Go to task archive G then E"
    if (!hasUndo) {
      toast(toastMessage)
      !_mbl&&toast(toastMessageNavigation)
    }
    const navigationOutcome = navigateToNextTask(true,currentTask.status !== "Archive", false, "forceNavigate")
    if (shouldApplyLocalArchivedStatus({ isUnarchiving, navigationOutcome })) {
      setCurrentTask((old) =>
        old
          ? {
              ...old,
              status: "Archive",
            }
          : old,
      )
    }
    if (currentTask.status === "Archive") await navigate("Refresh")

    
 
  };
    const undoHandler =useCallback(async (data: any, toastId: string) => {
      navigateToPreviousTask(true, true)
      setNotificationCountNull(true)
      await undoAction('UNDO_INBOX_ARCHIVE', data);
      queryClient.refetchQueries({ queryKey: ['inbox'] });
      navigate("Refresh")
  
      toast.dismiss(toastId);
    },[navigate, navigateToPreviousTask, queryClient, undoAction,currentItemInTasksPlaylist.uniqueIndex])
    
    const undoInboxArchive= (dataBeforeDeletion:any, remindMe?:boolean)=> {
        archiveNotificationGetter(dataBeforeDeletion.notification,"Notification",remindMe?null:undoHandler)
        setNotificationCountNull()
      }
  

  return {
    markAsDone,
    navigateToNextTask,
    navigateToPreviousTask
  }
}

export default useArchiveAndNavigate
