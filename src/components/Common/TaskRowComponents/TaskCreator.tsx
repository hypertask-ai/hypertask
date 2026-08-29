import React from 'react'

const TaskCreator = ({displayName}:{displayName:string})=>{

    return (
        <span
        className='max-w-[130px]'
        style={{ fontSize: 14 }}>
            {displayName}
        </span>
    )
}

export default TaskCreator