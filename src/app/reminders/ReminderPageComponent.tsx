/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */
"use client"
// import Head from 'next/head'

import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRecoilState } from '@/lib/state';
import { ArchivedTaskIndexAtom, activeItemAtom, showCommandsAtom, tasksPlayListAtom,inViewObjectAtom } from '@/store';

import {  IReminder, IUser } from '@/models/model';
import formatDateDifference from '@/utils/generateTime';
import axios from 'axios';
import { parseCookies } from 'nookies';
import { ArrowLeft, Check } from 'lucide-react';
import {  useQueryClient } from '@tanstack/react-query';
import { scrollToCenterIfNearBottom, scrollToCenterIfNearTop } from '@/utils/helperFunctions/helperFunctions';
import dynamic from 'next/dynamic';
import { useGetAllReminders } from '@/hooks/MultiPages/useGetAllReminders';
import Tooltip from '@/components/Common/Tooltip';
import toast from 'react-hot-toast';
import globalConstants from '@/lib/constants';
import useHypertasksRecoilStates from '@/hooks/RecoilRoot/useHypertasksRecoilStates';
const HypertasksCommands = dynamic(() => import("@/components/commands"),{ssr:false});

const ReminderPageComponent = ({
    _currentUser,
}:{
    _currentUser:IUser
}) => {
    if (!_currentUser){
        try {
            
            const cookies = parseCookies()
            _currentUser = JSON.parse(cookies.nookies_user)
            console.log("🚀 ~ file: archived.tsx:40 ~ _currentUser:", _currentUser)
        } catch (error) {
            console.log("🚀 ~ file: archived.tsx:45 ~ error:", error)
            
        }
    }

    // refs
    const currentHoveredDiv = useRef<number | null>(null);
    const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
    const taskRef = useRef<HTMLDivElement>(null);
    const lastgClick = useRef<number | null>(null);

    const [ArchivedTaskIndex, setArchivedTaskIndex] = useRecoilState(ArchivedTaskIndexAtom);
    const [_,setInViewObject] = useRecoilState(inViewObjectAtom);
    const [_activeItem, setActiveItem] = useRecoilState(activeItemAtom);
    const [__, setTasksPlayList] = useRecoilState(tasksPlayListAtom);
    const { toggleShowCommands }= useHypertasksRecoilStates()
    const [showCommands, setShowCommands] = useRecoilState(showCommandsAtom);

    const queryClient = useQueryClient();   
    // const blurTimeout = useRef<NodeJS.Timeout | null>(null);

    const router = useRouter();
    const [_reminders, setReminders] = useState<IReminder[]>([]);
    const [_selectedReminder, setSelectedReminder] = useState<IReminder | null>(_reminders[ArchivedTaskIndex??0]);
    const [fetching, setFetching] = useState(false)
    const [osName,setOsName] = useState<string>("Unknown");

    const {data:reminderFromQuery} = useGetAllReminders(_currentUser.id)

    // const tasksPlayList=_notifications.map({})

    const handleKeyDown = async(e: KeyboardEvent) => {
        var cmdControl = osName === "MacOS"&&e.metaKey || osName !== "MacOS"&&e.ctrlKey;
        const classNamesToReturnFrom = ["modal-open","ProseMirror ProseMirror-focused",undefined]
        const index = _reminders.findIndex(rem=>rem.id===_selectedReminder?.id)

        if (showCommands.show||
            document?.activeElement?.role==="dialog"||
            document?.activeElement?.id==="modalButtons"||
            document.activeElement?.tagName === "INPUT" ||
            document.activeElement?.id === "htc"||
            classNamesToReturnFrom.includes(document?.activeElement?.className)  || 
            document.activeElement?.id === "boardManager" ) return;

        if (e.key === "Escape") {
            // queryClient.refetchQueries({queryKey:["projectsAll"]});

            router.back()
    }
          // press k
          if (e.keyCode === 75 && cmdControl) {
            e.preventDefault();
            // console.log("1: change commands mode");
            toggleShowCommands();
        }
        
        if(_selectedReminder && e.key === '#' && e.shiftKey) {
            // const index = _reminders.indexOf(_selectedReminder)

            deleteTask(_selectedReminder, index)
        }

        if(e.key === "e" ) {
            e.preventDefault()
            if (_selectedReminder) {
                // const index = _reminders.indexOf(_selectedReminder)
                if (index >= 0 ) {
                    if (index>=0 && index<_reminders.length-1){
                        setSelectedReminder(_reminders[index+1])
                    }
                    else if (index===_reminders.length-1){
                        setSelectedReminder(_reminders[index-1])
                    }
                }
                invokeReminderHandler(_selectedReminder, index)
            }
        }

        if (e.key === "j" || e.key === "ArrowDown") {
            if (_selectedReminder) {
                console.log("🚀 ~ handleKeyDown ~ _selectedReminder:", _selectedReminder)
                console.log("🚀 ~ handleKeyDown ~ _reminders:", _reminders)
                console.log("🚀 ~ handleKeyDown ~ index:", index)
                if (index === -1 || index === (_reminders.length - 1)) {
                    // setSelectedReminder(_reminders[0])
                    // document.getElementById(`task-${_reminders[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                } else {
                    setSelectedReminder(_reminders[index + 1])
                    const activeElement = document.getElementById(`task-${_reminders[index + 1].id}`)
                    activeElement && scrollToCenterIfNearBottom(activeElement)

                }
            } else {
                if (_reminders.length > 0) {
                    setSelectedReminder(_reminders[0])
                    document.getElementById(`task-${_reminders[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
            }
        }

        if (e.key === "k" || e.key === "ArrowUp") {
            if (_selectedReminder) {
                // const index = _reminders.indexOf(_selectedReminder)
                if (index <= 0) {
                    // setSelectedReminder(_reminders[_reminders.length - 1])
                    // document.getElementById(`task-${_reminders[_reminders.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                } else {
                    setSelectedReminder(_reminders[index - 1])
                    const activeElement = document.getElementById(`task-${_reminders[index - 1].id}`)
                    activeElement && scrollToCenterIfNearTop(activeElement)

                }
            } else {
                if (_reminders.length > 0) {
                    setSelectedReminder(_reminders[_reminders.length - 1])
                    document.getElementById(`task-${_reminders[_reminders.length - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
            }
        }

        if (e.key === "Enter") {
            // console.log()
            openTask(_selectedReminder)
        }
           // cmd/ctrl + m
        if (e.keyCode===77 && cmdControl) {
            openTask(_selectedReminder, "reply")

        }
            

        if (e.key === "g") {
            const now = new Date().getTime();
            lastgClick.current = now;
        }

        if (e.key === 't') {
            const now = new Date().getTime();
            if (lastgClick.current && now - lastgClick.current < 5000) {
                lastgClick.current = null;
                router.push('/');
            }
        }
        if (e.key === 'i') {
            const now = new Date().getTime();
            if (lastgClick.current && now - lastgClick.current < 5000) {
                lastgClick.current = null;
                router.push(globalConstants.inboxRoute);
            }
        }
    }

    const openTask = async (reminder: IReminder | null = null, mode?:"reply") => {
        const query = mode==="reply"?"?reply=true":""
        if (!reminder) return
        setActiveItem(reminder.task?.id??null);
        router.push(`/detail/project-${reminder.task?.projectId}/${reminder.task?.uniqueIndex}`+query);
    }

    const deleteTask = async (reminder: IReminder, index: number) => {
        // setReminders(old => {
        //     old.splice(index, 1)
        //     return [...old]
        // })

        // try {
        //     await fetch(`/api/tasks/single`, {
        //         method: "PUT",
        //         headers: { "Content-Type": "application/json" },
        //         body: JSON.stringify({ newreminder: { id: reminder.task?.id, status: 'Deleted' } })
        //     })
        // } catch (error) {
        // }
    }

    const invokeReminderHandler = async (reminder: IReminder, index: number) => {
        // if (fetching) return

        // setFetching(true)
       
        try {
            await axios.post("/api/reminders/invokeReminder",{reminder:reminder})
            const newData =_reminders.filter((r,idx)=>idx!==index)
            console.log("🚀 ~ newData ~ newData:", newData)
            queryClient.setQueryData(["reminders"],newData)
            toast("Please check your inbox!")

        } catch (error) {
            console.log(error)
        }

    }

    const handleMouseEnter = (index: number) => {
        currentHoveredDiv.current = index;
        // console.log(index);
        // Set focus on the div when the mouse hovers over it
        // taskRef?.current[index]?.focus();
        // setSelectedReminder(_reminders[currentHoveredDiv.current])

      };
    
    const handleMouseLeave = () => {
    // Clear any existing debounceTimeout
    if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
        debounceTimeout.current = null;
    }

    // Start a new debounceTimeout to remove focus after a short delay (e.g., 100ms)
    debounceTimeout.current = setTimeout(() => {
        if (currentHoveredDiv.current !== null && taskRef.current) {
            (taskRef.current as HTMLDivElement)?.blur();
            currentHoveredDiv.current = null;
        }
        }, 100);
    };

    const handleMouseMove = () => {
    // Clear any existing debounceTimeout
        if (debounceTimeout.current) {
            setSelectedReminder(_reminders[currentHoveredDiv.current?currentHoveredDiv.current:0])
            clearTimeout(debounceTimeout.current);
            debounceTimeout.current = null;
        }
    };

    const fetchArchivedTasksAsFallback = async()=>{
        
        const fetchData = await axios.get(`/api/reminders/getAll?userId=${_currentUser.id}`)
        
        setReminders(fetchData.data)
    }

    useEffect(() => {
        // queryClient.refetchQueries({queryKey:["projectsAll"]});
        setArchivedTaskIndex(0)
        if (_selectedReminder){
            const elementToScrollTo =document.getElementById(`task-${_selectedReminder.id}`) 
            elementToScrollTo && scrollToCenterIfNearBottom(elementToScrollTo)
        }

        if (_reminders.length===0){
            fetchArchivedTasksAsFallback()
        }
        return () => {
            // Clear the debounceTimeout when the component unmounts
            if (debounceTimeout.current) {
            clearTimeout(debounceTimeout.current);
            }
            let name = "Unknown OS";
            if (navigator?.appVersion?.indexOf("Win") != -1) name = "Windows";
            if (navigator?.appVersion?.indexOf("Mac") != -1) name = "MacOS";
            
            setOsName(name)
        };

    }, []);

    useLayoutEffect(()=>{
        setReminders(reminderFromQuery)
        const tasksPlayList = reminderFromQuery.map((reminder: any)=>({projectId:reminder.task.projectId,uniqueIndex:reminder.task.uniqueIndex!})) 
        setTasksPlayList(tasksPlayList)
        !_selectedReminder&&setSelectedReminder(reminderFromQuery[ArchivedTaskIndex??0])
      },[reminderFromQuery])

      useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [lastgClick.current,  _selectedReminder, showCommands.show,_reminders]);

    useEffect(()=>{
        setInViewObject({taskId:_selectedReminder?.id??null, taskProjectId:_selectedReminder?.projectId??null})
    },[_selectedReminder])

    return (
        <>

            <div className='flex items-center justify-center flex-col w-full min-h-screen bg-taskDetailPage scrollbar-w-[0] '>
                <div className={`global-view-width min-h-screen py-6 px-4 md:py-9 md:px-16 flex flex-col items-start space-y-4 bg-containerBackground`}>
                    <p className='text-white-black'  style={{ fontSize: '24px' }}>Reminders</p>
                    <div onMouseMove={handleMouseMove} style={{ flex: 1, display: 'flex', width: '100%', flexDirection: 'column'}}>
                        {
                            _reminders?.map((reminder, i) => (
                                <div id={`reminder-${reminder.id}`} 
                                // onFocus={() => console.log('Focused on div:', task)}
                                    onMouseEnter={() => handleMouseEnter(i)}
                                    onMouseLeave={handleMouseLeave}
                                    ref={taskRef}
                                    onClick={() => openTask(reminder)}  
                                    key={reminder.id} 
                                    className={`flex items-start md:items-center gap-1 md:gap-0 md:space-x-8 cursor-pointer py-2 px-4  text-white-black
                                        border-l-4 border-transparent rounded-md
                                        ${(_selectedReminder && _selectedReminder.id === reminder.id) ? "bg-active-elementBg border-l-selected-item-border" : "transparent"}
                                        justify-between  w-full flex-col md:flex-row`}>
                                    <div className='flex textwhitebl space-x-6 w-full md:w-1/5'>
                                        <span style={{ fontSize: 13 }}>{reminder.task?.user?.displayName ?? ''}</span>
                                    </div>
                                    <div className='flex-1 flex-column w-full md:w-1/5 overflow-hidden'>
                                        <span style={{ whiteSpace: 'nowrap', fontSize: 13, overflow: 'hidden' }}>{reminder.task?.project?.title ?? reminder.task?.project?.name}</span>
                                    </div>
                                    <div className='truncate flex-1 flex-column w-full md:w-1/3'>
                                        <span 
                                        className=''
                                        style={{ fontSize: 13 }}>
                                            {reminder.task?.title ?? ''}
                                            {reminder.task?.uniqueIndex && <span style={{ fontSize: 13, color: '#8E9093', marginLeft: 8 }}>{`#${reminder.task?.uniqueIndex}`}</span>}
                                        </span>
                                    </div>
                                    <span
                                        className='font-bold' 
                                        style={{ color: '#8E9093', fontSize: 13 }}>
                                        
                                        Remind me:&nbsp;{formatDateDifference(reminder.remindAt,true)}
                                    </span>
                    
                                        <button
                                            className='relative group' 
                                            onClick={(e) =>{
                                                e.stopPropagation(); // Prevent the click event from propagating to the parent div
                                                invokeReminderHandler(reminder, i)
                                            }}
                                        >
                                            <Check
                                                className="font-bold " 
                                                size={16} 
                                                color={reminder.status === "Archive" ? 'green' : '#8E9093'}
                                                strokeWidth={1.75}
                                             />
                                            {
                                                reminder.status !=="Archive" && 
                                                <Tooltip
                                                    left={-48}
                                                    bottom={-49}
                                                    text="Remind now"
                                                    keyCombination={["E"]}
                                                    />
                                            }
                                        </button>
                                </div>
                            ))
                        }
                    </div>
                </div>
                <div className="relative group goback_btn hidden sm:block bg-back-button" onClick={()=>router.back()} style={{ cursor: 'pointer', position: 'absolute', zIndex: 3, top: 40, left: 40, width: 40, height: 40, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ArrowLeft size={18} className='text-white-black' strokeWidth={1.75} />
                    <Tooltip 
                        left={45}
                        bottom={2}
                        text='Back'
                        keyCombination={['ESC']}
                        />
                
                </div>
                
            </div>
            {showCommands.show && <HypertasksCommands />}

        </>
    )
}

export default ReminderPageComponent;
