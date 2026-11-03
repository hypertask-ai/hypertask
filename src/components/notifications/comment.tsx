import { INotification } from '@/models/model'
import formatDateDifference from '@/utils/generateTime';
import { convertToPlain } from '@/utils/helperFunctions/helperFunctions';
import React from 'react'
import TooltipPortal from '@/components/Common/TooltipPortal'
import { Check } from "lucide-react";

interface Props {
    notification: INotification,
    markAsDone: () => void,
    openTask: () => void,
    setSelectedInbox: () => void,
    _selectedInbox: INotification | null
}

const NotificationComment = (props: Props) => {
 
    const { notification, markAsDone, _selectedInbox, setSelectedInbox, openTask } = props
    const tooltip = <span style={{ left: "100%", top: 0 }} data-hover-tooltip-content className="absolute scale-100 whitespace-nowrap transition-transform rounded bg-white p-2 text-meta text-black">Mark Done   <kbd className="rounded-lg bg-[var(--bg-notification-key)] text-[var(--color-notification-key)] border-[var(--border-keycap)] px-0.5 py-0.5">E</kbd></span>;

    return (
        <div id={`inbox-${notification.id}`} onClick={() => openTask()} onMouseEnter={() => setSelectedInbox()} key={notification.id} className={`flex space-x-8 h-[70] py-2 border-l-8 border-transparent px-4 rounded-md ${(_selectedInbox && _selectedInbox.id === notification.id) ? "bg-[#363A40]  border-l-[#7396CB]" : "transparent"} justify-between  w-full flex-col md:flex-row`}>
            <div className='flex space-x-6 w-1/5'>
                <span style={{ fontSize: 14, color: 'whire' }}>{notification.comment?.creator?.displayName ?? ''}</span>
            </div>
            <div className='  truncate flex-1 flex-column w-1/4'>
                <span style={{ fontSize: 14, color: 'whire' }}>{notification.comment?.task?.title ?? ''}</span>
            </div>

            <div className='flex-1 truncate text-[#8E9093] flex-column w-1/4'>
                <span className='' style={{ color: '#8E9093', fontSize: 14 }}>
                    {convertToPlain(notification.comment?.text ?? '')}
                </span>
            </div>
            <span style={{ color: '#8E9093', fontSize: 14 }}>{formatDateDifference(notification.createdAt)}</span>
            <div className="group">
                <button 
                    onClick={(e) =>{
                    e.stopPropagation();
                    markAsDone()}}
                >
                    <Check size={15} color={(notification.status) === 'Archive' ? 'green' : '#8E9093'} strokeWidth={1.75} />
                    <TooltipPortal hover placement="trigger">{tooltip}</TooltipPortal>
                </button>
            </div>
        </div>
    )
}

export default NotificationComment
