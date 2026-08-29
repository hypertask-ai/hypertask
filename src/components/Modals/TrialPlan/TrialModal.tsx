import { ModalContainerCustom } from '@/components/Common/CommonModalComponents';
import React, { ReactNode, useEffect, useState } from 'react'
import styles from '@/styles/linksModal.module.scss'
import { useRecoilState } from '@/lib/state';
import { currentProjectAtom } from '@/store';
import { PlansTable, TrialsButton } from './TrialPlanComponents';
import { useAsyncRoutePush } from '@/hooks/General/useAsyncPush';
import { constructPricingPageUrl } from '@/utils/helperFunctions/helperFunctions';
import { ArrowLeft } from "lucide-react";
import Tooltip from '@/components/Common/Tooltip';
import Image from 'next/image';
import Goback from '@/assets/gobackicon.svg'

interface IProps {
    closeCallback:()=>void
}
const TrialModal: React.FC<IProps> = ({closeCallback}) => {
    const [shouldShow, setShouldShow] = useState(true)
    const [_currentProject, _] = useRecoilState(currentProjectAtom)
    const asyncPush = useAsyncRoutePush()
    if (!shouldShow || !_currentProject) return (<></>)

    const toggle = () => {
        setShouldShow(false)
        closeCallback()
    }

    const onClickSeeAllPlans = async()=>{
        await asyncPush(constructPricingPageUrl(_currentProject, "Upgrade"))
        closeCallback()
    }
    return (
        <ModalContainerCustom
            // fade={false}
            id="createTaskModal"
            fullScreen={true}
            autoFocus
            isOpen={shouldShow}
            key={`trial-plan-for-teamId:${_currentProject?.teamId}`}
            toggle={toggle}
            className={`${styles.links_modal}  relative`}
        >
            <PlansWrapper>
                <PlansTable />
                <div className='lg:mt-4 gap-3 max-w-[340px] flex flex-col '>
                    <TrialsButton teamId={_currentProject.teamId!} />
                    <SeeAllPlans onClick={onClickSeeAllPlans}/>
                    <p className="mt-2 dark:text-text-light-gray font-normal text-content text-text-light-gray">No payment is due today. If you change your mind, you can switch to the free plan any time.</p>
                </div>
            </PlansWrapper>
            <BackButton closeHandler={toggle}/>
        </ModalContainerCustom>
    )
}

export default TrialModal

const SeeAllPlans = ({onClick}:any)=>{
    return (
        <button className="py-2 rounded px-10 bg-kanban-active-cardbg text-content min-w-[280px]" onClick={onClick}>See all plans</button>

    )
}

const PlansWrapper = ({ children }: { children: ReactNode }) => {

    return (
        <div className='flex-col mx-auto h-SVH-full  flex items-center  text-white-black'>

            <div className={`min-h-[512px] max-w-[95vw] sm:max-w-[90vw] items-center flex flex-1 duration-200 ease-in-out `}>
                <div className="flex flex-col max-h-[90svh] overflow-y-auto lg:p-6 gap-2 sm:gap-4 text-center items-center justify-center text-white-black">

                            {children}
                </div>
            </div>
        </div>
    )
}

const BackButton = ({closeHandler}:any) => {

    return (
        <>

            <div
                className="fixed xs:hidden sm:flex gap-2  items-center  flex-col xl:flex-row xl:left-10 left-5"
                style={{
                    zIndex: 3,
                    top: 40,
                    justifyContent: "center" }}
            >
                <div
                    onClick={closeHandler}
                    style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20 }}
                    className="cursor-pointer justify-center items-center flex group bg-back-button shadow-md border-light-black-border-4"
                >
                    <ArrowLeft size={18} strokeWidth={1.75} className="text-button-arrow" />
                    <Tooltip
                        left={45}
                        bottom={2}
                        text='Back'
                        keyCombination={['ESC']}
                    />
                </div>
            </div>

            <div
                onClick={closeHandler}
                style={{ zIndex: 101, position: "fixed", bottom: 30, right: 16, borderRadius: 20, justifyContent: 'center' }}
                className="absolute sm:hidden cursor-pointer shadow-customshadow-2 flex w-fit px-3  py-[2px] h-fit gap-2  items-center bg-active-mentionList text-text-light-gray">
                {/* <ArrowLeft strokeWidth={1.75} color='#FFFFFF' /> */}
                <Image src={Goback} alt="icon" width={28} height={28} />
                <span>Back</span>
            </div>
        </>

    )
}
