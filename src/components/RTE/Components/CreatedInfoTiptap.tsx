import { MobileViewContext } from '@/lib/contexts/mobileContext';
import { useTiptapGlobalContext } from '@/lib/contexts/TaskDetail/TiptapProvider';
import formatDateDifference from '@/utils/generateTime';
import React, { useContext } from 'react'
import styles from '@/styles/tiptap.module.scss'

const CreatedInfoTiptap = () => {
    const {mode, stack, id, handleFocus, createdAt, user, creator} = useTiptapGlobalContext()
    const isMbl= useContext(MobileViewContext) ;
 // Check if createdAt is provided
 if (!creator?.createdAt|| !creator?.creator) {
    // If createdAt is not provided, render nothing
    return null;
 }
 // Mobile view rendering
 else if (isMbl) {
    return (
      <div className={` mb-[2px]`}>
        <span className="text-meta text-[#8E9093]">
          {!stack ? user?.displayName?.concat(',') : user?.displayName}
        </span>
        {!stack && (
          <span className={`text-meta justify-self-end text-[#8E9093] ${styles.unstacked_grid_row1}`}>
            {formatDateDifference(creator.createdAt)}
          </span>
        )}
      </div>
    );
 }

 // Non-mobile view rendering
 return (
    <div className="flex justify-between items-center">
      <span className={`${stack ? 'text-content' : 'text-meta'} text-[#8E9093]`}>
        {user?.displayName ? user?.displayName : creator.creator}
      </span>
      {!stack && (
        <span className={`text-meta justify-self-end text-[#8E9093] ${styles.unstacked_grid_row1}`}>
          {formatDateDifference(creator.createdAt)}
        </span>
      )}
    </div>
 );
}

export default CreatedInfoTiptap
