import { useTaskContext } from '@/lib/contexts/TaskDetail/TaskProvider';
import  {useContext, useCallback} from 'react'
import UpdateKanban from '../MultiPages/useUpdateTaskInBoards';
import useGlobalFocusHandler from '../Inbox/useGlobalFocusHandler';
import { useRecoilState } from '@/lib/state';
import { currentUserAtom, tasksPlayListAtom } from '@/store';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useUndoContext } from '../General/useUndo';
import { MobileViewContext } from "@/lib/contexts/mobileContext";
import useHypertasksNavigate from '../MultiPages/Route/useHypertasksNavigate';
import { useSearchParams } from 'next/navigation';
import {
  nextRemainingInboxTask,
  resolveTaskPlaylistNavigation,
  shouldApplyLocalArchivedStatus,
  type TaskArchiveNavigationOutcome,
} from '@/lib/taskDetailArchiveNavigation';

const useArchiveAndNavigate = () => {
  const queryClient = useQueryClient();
  const { undoAction} = useUndoContext();
  const _mbl = useContext(MobileViewContext);

  const {  currentItemInTasksPlaylist, onGoback, setCurrentTask, parsedTask:taskFromServer} = useTaskContext();
  const currentTask = JSON.parse(taskFromServer)

  const {removeFromListWithStatus}=UpdateKanban();
  const {moveIdxDown, moveIdxUp, archiveNotificationGetter} = useGlobalFocusHandler()
  const [tasksPlayList, setTasksPlaylist] = useRecoilState(tasksPlayListAtom);
  const [currentUser,_setCurrentUser] = useRecoilState(currentUserAtom);
  const {navigate} =useHypertasksNavigate()
  const searchParams = useSearchParams()

/**
 * just to set count of notifications to 0
 *
 * @param {boolean} [undo] if given, always set to 1
 */
const setNotificationCountNull = (undo?:boolean)=> {
   // @ts-ignore
   setCurrentTask((old) => ({
    ...old,
    _count:{
      notifications:undo?1:0
    }
  }));
}
// --------------------------- navigate to next task handler [j]
const navigateToNextTask = (archiveNotification?:boolean,shouldNavigate?:boolean, remindMe?:boolean, force?:"forceNavigate", inboxFlow?:string|null): TaskArchiveNavigationOutcome=>{
  const indexOf = tasksPlayList?.findIndex(obj =>obj.projectId === currentItemInTasksPlaylist.projectId && obj.uniqueIndex === currentItemInTasksPlaylist.uniqueIndex);
  const inInbox = currentTask?.notifications&&currentTask?.notifications[0]
  const activeInboxFlow = inboxFlow ?? searchParams?.get("inboxFlow")
  const missingInboxTarget = activeInboxFlow && indexOf === -1 && tasksPlayList
    ? nextRemainingInboxTask(tasksPlayList, currentItemInTasksPlaylist)
    : undefined


  // =========================== user presses [e] so archive notifications for this task too and update the key. 
  if (archiveNotification && currentTask){

    if (!currentTask._count?.notifications){
      console.log("🚀 ~ navigateToNextTask ~ currentTask:", currentTask)
      if (force==="forceNavigate") moveIdxDown()
      else{
        setNotificationCountNull()
        toast("This task is not in inbox")
        return "stayed"
      }
    } 
         
    // Archive whenever the task actually carries an inbox notification, even
    // when there is no inbox playlist (e.g. the task was opened directly by
    // URL). Previously this was gated on tasksPlayList, so the "Remove
    // notification" button silently no-opped on directly-opened tasks.
    if(inInbox){
       undoInboxArchive({notification:inInbox, currentUser:currentUser}, remindMe)
      if(!shouldNavigate) navigate('Refresh')
      }
  }
  else  moveIdxDown()

  if (!shouldNavigate)return "stayed"
  // ============================ navigate to next task
  // No playlist at all (task opened directly): any action that requested
  // navigation must still leave the now-stale task detail.
  const hasPlaylist = !!(currentTask&&currentTask.projectId&&tasksPlayList&&tasksPlayList.length>0)
  // A snooze must always leave the task page: when the playlist can't place the
  // current task, fall back to going back (HTPR-4595).
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
  // The playlist holds other tasks but not this one, so nothing navigates and
  // the detail page keeps rendering the task that was just archived.
  return "stayed"
}

// --------------------------- navigate to previous task handler [k]
const navigateToPreviousTask = useCallback((isUndoClicked:boolean, isUndo:boolean, inboxFlow?: string | null)=>{

  if (currentTask&&currentTask.projectId&&tasksPlayList&&tasksPlayList.length>0){
    const indexOf = tasksPlayList.findIndex(obj =>obj.projectId === currentItemInTasksPlaylist.projectId && obj.uniqueIndex === currentItemInTasksPlaylist.uniqueIndex);
    const indexToGoTo = isUndoClicked?indexOf:indexOf-1
    const taskToGoTo = tasksPlayList[indexToGoTo]
    if (!taskToGoTo) return
    const inboxParam=inboxFlow?'?inboxFlow=true':''
    const URL = `/detail/project-${taskToGoTo.projectId}/${taskToGoTo.uniqueIndex}${inboxParam}`
    navigate("Replace",URL)

    // if undo was clicked. take back to the exact taskk
    if (isUndoClicked) moveIdxUp()
    

   
    else if (indexOf <= 0 || isUndo && indexOf===tasksPlayList.length-1 ) {
      // setSelectedTask(_tasks[_tasks.length - 1])
      // document.getElementById(`task-${_tasks[_tasks.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      // navigateAndMoveUp()
      moveIdxUp()

    }
    // function navigateAndMoveUp (){
    //   moveIdxUp()
    // }
  }
},[currentItemInTasksPlaylist.projectId, currentItemInTasksPlaylist.uniqueIndex, currentTask, moveIdxUp, navigate, tasksPlayList])

  // ----------------------- [PRESS E] || [CLICK ON MARK AS DONE] (mark as done)
  const markAsDone = async (forceNavigate?:boolean) => {
    if (!currentTask) return;
    // const response = await fetch(`/api/tasks/single`, {
    //   method: "PUT",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({
    //     newTask: {
    //       id: currentTask.id,
    //       status: currentTask.status === "Archive" ? "Normal" : "Archive",
    //     },
    //   }),
    // });
    const isUnarchiving = currentTask.status === "Archive";
    await removeFromListWithStatus(
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
    // Archiving immediately leaves this task detail. Keep its active archive
    // icon visible until navigation instead of optimistically flashing the
    // restore state. Unarchiving remains on the page, so update that state
    // after the mutation succeeds.
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
    toast(toastMessage)
    !_mbl&&toast(toastMessageNavigation)
    const navigationOutcome = navigateToNextTask(true,currentTask.status !== "Archive", false, "forceNavigate")
    // Archiving usually leaves the page, but when the playlist cannot place this
    // task nothing navigates. Show the archived state immediately instead of
    // leaving a stale "not archived" icon until a reload (HTPR-5480).
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
    // Refresh only when un-archiving (no navigation happens then). When archiving,
    // navigateToNextTask queues router.replace to the next task and a refresh here
    // cancels that navigation (HTPR-4234).
    if (currentTask.status === "Archive") await navigate("Refresh")

    
 
  };
    // undoHandler function
    const undoHandler =useCallback(async (data: any, toastId: string) => {
      // console.log('🚀 ~ undoHandler ~ data:', data);
      // first, you need to bring the item back to its place.
      // then, you need to run the API call so there is no render blocking.
      navigateToPreviousTask(true, true)
      setNotificationCountNull(true)
      await undoAction('UNDO_INBOX_ARCHIVE', data);
      queryClient.refetchQueries({ queryKey: ['inbox'] });
      navigate("Refresh")
  
      toast.dismiss(toastId);  // Dismiss the toast here
    },[navigate, navigateToPreviousTask, queryClient, undoAction,currentItemInTasksPlaylist.uniqueIndex])
    
    // ================= UNDO ARCHIVE INBOX NOTIFICATION =============== 
    const undoInboxArchive= (dataBeforeDeletion:any, remindMe?:boolean)=> {
        // Make the necessary API call to delete the todo using Prisma
        // Store the necessary information for undo
        archiveNotificationGetter(dataBeforeDeletion.notification,"Notification",remindMe?null:undoHandler)
        setNotificationCountNull()
        // performActionAndStoreUndoData(dataBeforeDeletion,"Undo archive", undoHandler);
      }
  

  return {
    markAsDone,
    navigateToNextTask,
    navigateToPreviousTask
  }
}

export default useArchiveAndNavigate
