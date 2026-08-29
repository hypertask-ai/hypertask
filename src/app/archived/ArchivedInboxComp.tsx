/* eslint-disable react/jsx-key */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */
"use client"

import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRecoilState } from '@/lib/state';
import { ArchivedTaskIndexAtom, activeItemAtom, showCommandsAtom, tasksPlayListAtom,inViewObjectAtom } from '@/store';

import {  INotification, ITask, IUser } from '@/models/model';
import formatDateDifference from '@/utils/generateTime';
import axios from 'axios';
import { parseCookies } from 'nookies';
import {  useQueryClient } from '@tanstack/react-query';
import {  scrollToCenterIfNearBottom, scrollToCenterIfNearTop } from '@/utils/helperFunctions/helperFunctions';
import { NotificationProvider, useNotificationContext } from '@/lib/contexts/NotificationContext';
import Tooltip from '@/components/Common/Tooltip';
import { ArchiveNotificationIcon } from '@/lib/IconsLocal';
import { NotificationContent } from '@/components/notifications/NotificationRow';
import globalConstants from '@/lib/constants';
import useHypertasksNavigate from '@/hooks/MultiPages/Route/useHypertasksNavigate';
import { useGetUserPreferences } from '@/hooks/General/useGetUserPreferences';
import { useArchiveInfiniteScroll } from './useArchiveInfiniteScroll';

const ArchivedNotificationsContainer = ({
    _currentUser,
    data,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage
}:{
    _currentUser:IUser,
    data:INotification[],
    isFetching:boolean,
    isFetchingNextPage:boolean,
    hasNextPage?:boolean,
    fetchNextPage: () => Promise<unknown>
}) => {
    if (!_currentUser){
        try {
            
            const cookies = parseCookies()
            _currentUser = JSON.parse(cookies.nookies_user)
        } catch (error) {
            
        }
    }
    const queryClient = useQueryClient();   
    const router = useRouter();
    const { navigateToTask } = useHypertasksNavigate()

    // refs
    const currentHoveredDiv = useRef<number | null>(null);
    const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
    const taskRef = useRef<HTMLDivElement>(null);
    const lastgClick = useRef<number | null>(null);
    const sentinelRef = useArchiveInfiniteScroll({
        enabled: !isFetching,
        hasNextPage,
        isFetchingNextPage,
        fetchNextPage,
    });

    const [, setArchivedTaskIndex] = useRecoilState(ArchivedTaskIndexAtom);
    const [_,setInViewObject] = useRecoilState(inViewObjectAtom);
    const [_activeItem, setActiveItem] = useRecoilState(activeItemAtom);
    const [__, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
    const [showCommands] = useRecoilState(showCommandsAtom);
    const [notifications, setNotifications] = useState<INotification[]>(data);
    const [selectedIndex, setSelectedIndex] = useState<number>(0);
    const [osName,setOsName] = useState<string>("Unknown");
    const { data: userPreferences } = useGetUserPreferences();
    
    const handleKeyDown = async(e: KeyboardEvent) => {
        var cmdControl = osName === "MacOS"&&e.metaKey || osName !== "MacOS"&&e.ctrlKey;
        const classNamesToReturnFrom = ["modal-open","ProseMirror ProseMirror-focused",undefined]

        if (showCommands.show||
            document?.activeElement?.role==="dialog"||
            document?.activeElement?.id==="modalButtons"||
            document.activeElement?.tagName === "INPUT" ||
            document.activeElement?.id === "htc"||
            classNamesToReturnFrom.includes(document?.activeElement?.className)  || 
            document.activeElement?.id === "boardManager" ) return;

        
        if (e.key === "e" ) {
            e.preventDefault()
            eHandler()
        }

        // [j] for down
        if (e.key === "j" || e.key === "ArrowDown") ArrowDownHandler()

        // [k] for up
        if (e.key === "k" || e.key === "ArrowUp") ArrowUpHandler()

        // [enter]
        if (e.key === "Enter" && notifications[selectedIndex]?.task) openTask(notifications[selectedIndex].task)
        
        // cmd/ctrl + m
        if (e.keyCode===77 && cmdControl && notifications[selectedIndex]?.task) openTask(notifications[selectedIndex].task, "reply")

        // [g]
        if (e.key === "g") gPressHandler()
        
        // [g]->[b]
        if (e.key === 'b') gThenB()
        
        // [g]->[i]
        if (e.key === 'i') gThenI()
        if (e.key === 't') gThenT()
    }

   // [e] for unarchive
   const eHandler = (index = selectedIndex)=>{
        if (notifications[index]) {
        if (index >= 0 ) {
            if (index===notifications.length-1){

                setSelectedIndex(prev=>Math.max(prev-1, 0))
            }
            markAsUnarchive(notifications[index])
        }
    }
    }

    // [j] for down
    const ArrowDownHandler = ()=>{
        if (notifications[selectedIndex]) {
            if (selectedIndex === -1 || selectedIndex === (notifications.length - 1)) {
            } else {
                setSelectedIndex((prev)=>prev+1)
                const activeElement = document.getElementById(`task-${notifications[selectedIndex + 1].id}`)
                activeElement && scrollToCenterIfNearBottom(activeElement)

            }
        } else {
            if (notifications.length > 0) {
                setSelectedIndex(0)
                document.getElementById(`task-${notifications[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        }
    }

    // [k] for up
    const ArrowUpHandler = ()=>{
        if (notifications[selectedIndex]) {
            if (selectedIndex <= 0) {
            } else {
                setSelectedIndex(prev=>prev-1)
                const activeElement = document.getElementById(`task-${notifications[selectedIndex - 1].id}`)
                activeElement && scrollToCenterIfNearTop(activeElement)

            }
        } else {
            if (notifications.length > 0) {
                setSelectedIndex(notifications.length - 1)
                document.getElementById(`task-${notifications[notifications.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        }
    }

    // [g]
    const gPressHandler=()=>{
        const now = new Date().getTime();
        lastgClick.current = now;
    }

    // g->i
    const gThenI =()=>{
        const now = new Date().getTime();
        if (lastgClick.current && now - lastgClick.current < 5000) {
            lastgClick.current = null;
            router.push(globalConstants.inboxRoute);
        }
    }

    // g->t
    const gThenB=()=>{
        const now = new Date().getTime();
        if (lastgClick.current && now - lastgClick.current < 5000) {
            lastgClick.current = null;
            router.push('/');
        }
    }


    // g->h
    const gThenT=()=>{
        const now = new Date().getTime();
        if (lastgClick.current && now - lastgClick.current < 5000) {
            lastgClick.current = null;
            router.push(globalConstants.timersRoute);
        }
    }

    const openTask = async (task: ITask | null = null, mode?:"reply") => {
        const query = mode==="reply"?"?reply=true":""
        if (!task) return
        setActiveItem(task.id);
        navigateToTask(task.projectId, task.uniqueIndex, "push", query)
    }

    const markAsUnarchive = async (notification: INotification) => {
   
        try {
            await axios.post("/api/notifications/unArchiveNotificationById",{notificationId:notification.id})
            queryClient.refetchQueries({queryKey:["archivedInbox"]});
            queryClient.refetchQueries({queryKey:["archivedInboxMeta"]});

        } catch (error) {
        }
    }

    const handleMouseEnter = (index: number) => currentHoveredDiv.current = index;
    
    const handleMouseLeave = () => {
    if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
        debounceTimeout.current = null;
    }

    debounceTimeout.current = setTimeout(() => {
        if (currentHoveredDiv.current !== null && taskRef.current) {
            (taskRef.current as HTMLDivElement)?.blur();
            currentHoveredDiv.current = null;
        }
        }, 100);
    };

    const handleMouseMove = () => {
        if (debounceTimeout.current) {
            setSelectedIndex(currentHoveredDiv.current?currentHoveredDiv.current:0)
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }
    };

    useEffect(() => {
        setArchivedTaskIndex(0)
        let name = "Unknown OS";
        if (navigator?.appVersion?.indexOf("Win") != -1) name = "Windows";
        if (navigator?.appVersion?.indexOf("Mac") != -1) name = "MacOS";
        setOsName(name)
        if (notifications[selectedIndex]){
            const elementToScrollTo =document.getElementById(`task-${notifications[selectedIndex].id}`) 
            elementToScrollTo && scrollToCenterIfNearBottom(elementToScrollTo)
        }

        return () => {
            if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            }
        };

    }, []);

    useLayoutEffect(()=>{
        setNotifications(data)
        const tasksPlayList = data
            ?.filter((notification) => notification.task)
            .map((notification) => ({
                projectId: notification.task.projectId,
                uniqueIndex: notification.task.uniqueIndex,
            }))
        setTasksPlayList(tasksPlayList)
      },[data])

      useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [lastgClick.current, notifications, notifications[selectedIndex], showCommands.show]);

    useEffect(()=>{
        setInViewObject({taskId:notifications[selectedIndex]?.task.id??null, taskProjectId:notifications[selectedIndex]?.task.projectId??null})
    },[selectedIndex, notifications])

    return (
        <>
  
            <div onMouseMove={handleMouseMove} style={{ flex: 1, display: 'flex', width: '100%', flexDirection: 'column' }}>
                {
                    notifications?.map((notification, i) => (
                        notification.task&&
                        <NotificationProvider selectedSplit='' isIbxSlctd={false} notification={notification} displayAvatar={userPreferences?.displayAvatar}>
                            <TaskRowComponent
                                 index={i}
                                 taskRef={taskRef}
                                 openTask={openTask}
                                 handleMouseLeave={handleMouseLeave}
                                 handleMouseEnter={handleMouseEnter}
                                 selected={selectedIndex===i}
                                 eHandler={eHandler}
                                 />
                        </NotificationProvider>
                            ))
                        }
                <div ref={sentinelRef} className="h-8 w-full" />
                {isFetchingNextPage && (
                    <div className="self-center py-4 text-content text-text-light-gray">
                        Loading...
                    </div>
                )}
            </div>
             
                

        </>
    )
}

const TaskRowComponent = (
    {
        taskRef,
        handleMouseLeave,
        handleMouseEnter,
        openTask,
        selected,
        index,
        eHandler
    }:
    {
        taskRef:React.RefObject<HTMLDivElement | null>,
        handleMouseLeave: () => void,
        handleMouseEnter: (index: number) => void,
        openTask: (task?: ITask | null, mode?: "reply") => Promise<void>,
        selected:boolean,
        index:number,
        eHandler: (index?: number) => void
    },

    
    )=>{
        const { notification} = useNotificationContext();

        return (

            
            <div id={`task-${notification.id}`} 
                onMouseEnter={() => handleMouseEnter(index)}
                onMouseLeave={handleMouseLeave}
                ref={taskRef}
                onClick={() => openTask(notification.task)}  
                key={notification.task.id} 
                className={`flex items-center space-x-8 cursor-pointer py-2 px-4 border-l-4 border-transparent rounded-md ${selected  ? "bg-active-list-element border-l-selected-item-border" : "transparent"} justify-between  w-full flex-col md:flex-row`}>
                <div className='flex sm:space-x-6 sm:w-1/5'>                                           
                    <div className='flex justify-between w-100'>
                            <span className="text-white-black" style={{ fontSize: 13 }}>
                                {notification?.fromUser?.displayName}
                            </span>

                        <span
                        className="block sm:hidden text-text-light-gray"
                        suppressHydrationWarning
                        style={{
                            fontSize: 13 }}
                        >
                        {formatDateDifference(notification.createdAt)}
                        </span>
                    </div>
                </div>

                {/* -------------- task title ----------------- */}
                <TaskTitleUniqueIndex title={notification.task.title} uniqueIndex={notification.task.uniqueIndex}/>
                <NotificationContent/>
                    <ButtonGroup eHandler={eHandler} index={index}/>
            </div>
    )
}

const ButtonGroup = ({
    eHandler,
    index,
}: {
    eHandler: (index?: number) => void;
    index: number;
})=>{
    return (
        <>
       <button
                tabIndex={-1}
                className="relative group"
                onClick={(e) => {
                e.preventDefault();
                e.stopPropagation(); // Prevent the click event from propagating to the parent div
                    eHandler(index);
                }}
            >
                <Tooltip
                    left={-168}
                    bottom={-40}
                    text="Restore this notification"
                    keyCombination={["E"]}
                />
                <ArchiveNotificationIcon show={true} />
            </button>
        </>
    )
}

const TaskTitleUniqueIndex = ({title, uniqueIndex}:{title:string,uniqueIndex:number})=>{
    return (
        <div className=' flex-[2] truncate flex-column text-white-black'>
                    <span className='truncate text-white-black' style={{ fontSize: 13 }}>
                        {title ?? ''}
                        {uniqueIndex && <span className='text-text-light-gray' style={{ fontSize: 13, marginLeft: 8 }}>{`#${uniqueIndex}`}</span>}
                    </span>
                </div>
    )
}

export default ArchivedNotificationsContainer;
