/* eslint-disable react/jsx-key */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */
"use client"

import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRecoilState } from '@/lib/state';
import { ArchivedTaskIndexAtom, activeItemAtom, showCommandsAtom, tasksPlayListAtom,inViewObjectAtom } from '@/store';

import {  ITask, IUser } from '@/models/model';
import formatDateDifference from '@/utils/generateTime';
import { parseCookies } from 'nookies';
import { Check } from 'lucide-react';
import {  useQueryClient } from '@tanstack/react-query';

import { scrollToCenterIfNearBottom, scrollToCenterIfNearTop } from '@/utils/helperFunctions/helperFunctions';
import Tooltip from '@/components/Common/Tooltip';
import globalConstants from '@/lib/constants';
import { useDeviceContext } from '@/lib/contexts/deviceContext';
import useHypertasksNavigate from '@/hooks/MultiPages/Route/useHypertasksNavigate';
import { useArchiveInfiniteScroll } from './useArchiveInfiniteScroll';

const ArchivedTasksContainer = ({
    tasksFromQuery,
    _currentUser,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage
}:{
    tasksFromQuery:ITask[],
    _currentUser:IUser,
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

    const queryClient = useQueryClient();   
    const router = useRouter();
    const [_tasks, setTasks] = useState<ITask[]>(tasksFromQuery);
    const [selectedIndex, setSelectedIndex] = useState<number>(0);

    const [osName,setOsName] = useState<string>("Unknown");
    
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

        if(e.key === "e" && (osName === "MacOS"?e.metaKey:e.ctrlKey) ) {
            e.preventDefault()
            eHandler()
        }

        // [j] for down
        if (e.key === "j" || e.key === "ArrowDown") ArrowDownHandler()

        // [k] for up
        if (e.key === "k" || e.key === "ArrowUp") ArrowUpHandler()

        // [enter]
        if (e.key === "Enter") openTask(tasksFromQuery[selectedIndex])
        
        // cmd/ctrl + m
        if (e.keyCode===77 && cmdControl) openTask(tasksFromQuery[selectedIndex], "reply")
        if (e.key === "g") gPressHandler()
        if (e.key === 'b') gThenB()
        if (e.key === 'i') gThenI()
        if (e.key === 't') gThenT()
    }

   // [e] for unarchive
   const eHandler = (task?:ITask, index?:number)=>{
        const targetTask = task ?? tasksFromQuery[selectedIndex];
        const targetIndex = index ?? selectedIndex;

        if (targetTask) {
            if (targetIndex >= 0 ) {
                if (targetIndex===tasksFromQuery.length-1){
                    setSelectedIndex(prev=>Math.max(prev-1, 0))
                }
                markAsUnarchive(targetTask)
            }
        }
    }

    // [j] for down
    const ArrowDownHandler = ()=>{
        if (tasksFromQuery[selectedIndex]) {
            const index = _tasks.findIndex((task)=>task.id===tasksFromQuery[selectedIndex].id)
            if (index === -1 || index === (_tasks.length - 1)) {
            } else {
                setSelectedIndex((prev)=>prev+1)
                const activeElement = document.getElementById(`task-${_tasks[index + 1].id}`)
                activeElement && scrollToCenterIfNearBottom(activeElement)

            }
        } else {
            if (_tasks.length > 0) {
                setSelectedIndex(0)
                document.getElementById(`task-${_tasks[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
        }
    }

    // [k] for up
    const ArrowUpHandler = ()=>{
        if (tasksFromQuery[selectedIndex]) {
            const index = _tasks.findIndex((task)=>task.id===tasksFromQuery[selectedIndex].id)
            if (index <= 0) {
            } else {
                setSelectedIndex(prev=>prev-1)
                const activeElement = document.getElementById(`task-${_tasks[index - 1].id}`)
                activeElement && scrollToCenterIfNearTop(activeElement)

            }
        } else {
            if (_tasks.length > 0) {
                setSelectedIndex(tasksFromQuery.length - 1)
                document.getElementById(`task-${_tasks[_tasks.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
        navigateToTask(task.projectId, task.uniqueIndex, 'push', query)
    }

    const markAsUnarchive = async (task: ITask) => {

        try {
            await fetch(`/api/tasks/single`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ newTask: { id: task.id, status: 'Normal' } })
            })
            queryClient.refetchQueries({queryKey:["archived"]});
            queryClient.refetchQueries({queryKey:["archivedMeta"]});

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
        if (tasksFromQuery[selectedIndex]){
            const elementToScrollTo =document.getElementById(`task-${tasksFromQuery[selectedIndex].id}`) 
            elementToScrollTo && scrollToCenterIfNearBottom(elementToScrollTo)
        }

        return () => {
            if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            }
        };

    }, []);

    useLayoutEffect(()=>{
        setTasks(tasksFromQuery)

        const tasksPlayList = tasksFromQuery.map((task: any)=>({projectId:task.projectId,uniqueIndex:task.uniqueIndex!})) 
        setTasksPlayList(tasksPlayList)
        
      },[tasksFromQuery])
      useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [lastgClick.current, _tasks, tasksFromQuery[selectedIndex], showCommands]);

    useEffect(()=>{
        setInViewObject({taskId:tasksFromQuery[selectedIndex]?.id??null, taskProjectId:tasksFromQuery[selectedIndex]?.projectId??null})
    },[selectedIndex, tasksFromQuery])

    return (
        <>
  
            <div onMouseMove={handleMouseMove} style={{ flex: 1, display: 'flex', width: '100%', flexDirection: 'column' }}>
                {
                    tasksFromQuery?.map((task: ITask, i: number) => (
                       <TaskRowComponent
                            index={i}
                            taskRef={taskRef}
                            openTask={openTask}
                            handleMouseLeave={handleMouseLeave}
                            handleMouseEnter={handleMouseEnter}
                            selected={tasksFromQuery[selectedIndex]?.id===task.id}
                            eHandler={eHandler}
                            task={task}
                            />
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
        task,
        taskRef,
        handleMouseLeave,
        handleMouseEnter,
        openTask,
        selected,
        index,
        eHandler
    }:
    {
        task:ITask,
        taskRef:React.RefObject<HTMLDivElement | null>,
        handleMouseLeave: () => void,
        handleMouseEnter: (index: number) => void,
        openTask: (task?: ITask | null, mode?: "reply") => Promise<void>,
        selected:boolean,
        index:number,
        eHandler: (task?: ITask, index?: number) => void
    },

    
    )=>{

        return (
            <div id={`task-${task.id}`} 
                onMouseEnter={() => handleMouseEnter(index)}
                onMouseLeave={handleMouseLeave}
                ref={taskRef}
                onClick={() => openTask(task)}  
                key={task.id} 
                className={`flex md:items-center space-x-8 cursor-pointer py-2 px-4 border-l-4 border-transparent rounded-md ${selected  ? "bg-active-list-element border-l-selected-item-border" : "transparent"} justify-between  w-full flex-col md:flex-row`}>
                {/* <div className='flex space-x-6 w-1/5 text-white-black'>
                    <span style={{ fontSize: 14 }}>{task.user?.displayName ?? ''}</span>
                </div> */}

                {/* -------------- project name ---------------- */}
                <ProjectName title={task.project?.title ?? task.project?.name}/>
                
                {/* -------------- task title ----------------- */}
                <TaskTitleUniqueIndex title={task.title} uniqueIndex={task.uniqueIndex}/>
                <span style={{ color: '#8E9093', fontSize: 13 }}>{formatDateDifference(task.archivedAt!)}</span>
                <div className="group"
                    onClick={(e) =>{
                    e.stopPropagation(); // Prevent the click event from propagating to the parent div
                    eHandler(task, index)}}
                >
                    <ButtonGroup status={task.status}/>
                </div>
            </div>
    )
}

const ButtonGroup = ({status}:{status:string|undefined})=>{
    const isApple = useDeviceContext()

    return (
        <>
        <button
                tabIndex={-1}
                className="relative group"
            >
                <Tooltip
                    left={-168}
                    bottom={-40}
                    text="Unarchive this task"
                    keyCombination={[`${!isApple?"CTRL":"CMD"}`,"E"]}
                    />
            <Check size={15} color={(status) === 'Archive' ? 'green' : '#8E9093'} strokeWidth={1.75} />
                {/* <FiCheck size={15} color={notification.type==="Assigned"? (notification.assignee?.task?.status === 'Archive' ? 'green' : '#8E9093'): (notification.comment?.task?.status === 'Archive' ? 'green' : '#8E9093')} /> */}
        </button>
      
        </>
    )
}

const ProjectName = ({title}:{title:string|undefined})=>{
    return (
        <div className='flex-column w-1/5 text-white-black overflow-hidden'>
            <span style={{ whiteSpace: 'nowrap', fontSize: 13, overflow: 'hidden' }}>{title??""}</span>
        </div>
    )
}

const TaskTitleUniqueIndex = ({title, uniqueIndex}:{title:string,uniqueIndex:number})=>{
    return (
        <div className=' truncate flex-1 flex-column w-1/3 text-white-black'>
                    <span style={{ fontSize: 13 }}>
                        {title ?? ''}
                        {uniqueIndex && <span className='text-icon-dark-gray' style={{ fontSize: 13, marginLeft: 8 }}>{`#${uniqueIndex}`}</span>}
                    </span>
                </div>
    )
}

export default ArchivedTasksContainer;
