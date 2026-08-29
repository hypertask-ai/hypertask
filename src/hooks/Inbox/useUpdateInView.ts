import React, { useEffect, useCallback } from 'react'
import { useRecoilState } from '@/lib/state';
import {  inViewObjectAtom, globalNotificationFocusAtom } from '@/store';
import { INotification } from '@/models/model';


interface IUpdateInViewInput {
    value: number;
    index: number;
    selectedReset: INotification | null | undefined;
    initialFocus: number;
    _notifications: INotification[];
}



const useUpdateInView = ({
        value,
        index,
        selectedReset,
        initialFocus,
        _notifications,
    }: IUpdateInViewInput) => {
    const [___,setInViewObject] = useRecoilState(inViewObjectAtom);
    const [globalFocus, setGlobalFocus] = useRecoilState(globalNotificationFocusAtom);

    const updateInView =useCallback(()=>{
        if(value !== index) return
        setInViewObject(
            {
                taskId:_notifications[globalFocus.currIdx]?.taskId??null,
                taskProjectId:_notifications[globalFocus.currIdx]?.projectId??null, 
                sectionId:_notifications[globalFocus.currIdx]?.task?.sectionId??null,
                taskTicketNumber:_notifications[globalFocus.currIdx]?.task?.ticketNumber??null,
                sectionTitle:_notifications[globalFocus.currIdx]?.task?.section??null,
                taskTitle:_notifications[globalFocus.currIdx]?.task?.title??null,
            })
      },[_notifications, globalFocus.currIdx, index, setInViewObject, value])

    useEffect(()=>{
        updateInView()
    },[selectedReset, initialFocus, updateInView])

    return {updateInView}
}

export default useUpdateInView