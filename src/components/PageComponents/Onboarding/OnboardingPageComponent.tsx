"use client"

import { OnboardingScreen5 } from "@/components/PageComponents/Onboarding/Screens/OnboardingScreen5"
import { useState, useEffect, useRef } from "react"
import CreateTeamOnboardingScreen from "./Screens/CreateTeamOnboardingScreen"
import { cn } from "@/utils/undoActions/helperFuncs"
import { useSearchParams } from "next/navigation"
import { companySizeOptions } from "@/lib/constants/constants"
import { LaunchHypertaskOnboardingScreen } from "./Screens/LaunchHypertaskOnboardingScreen"
import { GenerateBoardOnboardingScreen } from "./Screens/GenerateBoardOnboardingScreen"
import { ConnectAIOnboardingScreen } from "./Screens/ConnectAIOnboardingScreen"

interface IProps{
    isUserNew:boolean,
    teamToInviteTo:{
        id:string,
        title:string
    }
}
   
const  OnboardingPageComponent:React.FC<IProps> = ({isUserNew, teamToInviteTo})=>{
    const params = useSearchParams()
    const companySize = params?.get("companySize")
    const resumeKey = params?.get("resumeKey")
    const shouldSkipInvite = companySize === companySizeOptions[0]
    const [loaded, setLoaded] = useState(false)
    const [currIdx, setCurrIdx] = useState(0)
    const resumeAppliedRef = useRef(false)
    useEffect(()=>{
        setTimeout(() => {
            setLoaded(true)
        }, 300);
    },[])

    const onNextScreen = ()=>{
        setLoaded(false)
        setTimeout(() => {
            if (currIdx === screenCount -1) return
            else setCurrIdx(prev=>prev+1)
            setLoaded(true)
        }, 200);
        
    }

    const jumpToScreen = (screenNumber:number)=>{
        if (currIdx === screenNumber) return 
        setLoaded(false)
        setTimeout(() => {
            setCurrIdx(screenNumber)
            setLoaded(true)
        }, 200);
    }

    // Invited / allowed-domain members already have a team and a board, so they skip the
    // team-setup and board-generation steps and get the trimmed sequence. The
    // keyboard-first tutorial is disabled, so both paths proceed directly to
    // launch after their remaining setup steps. See
    // https://app.hypertask.ai/detail/project-15/4189 and
    // https://app.hypertask.ai/detail/project-15/5424.
    const Screens = [
        ...(isUserNew ? [<CreateTeamOnboardingScreen key={"create-team-screen"} />] : []),
        ...(isUserNew ? [<GenerateBoardOnboardingScreen key={"generate-board-screen"} onNextScreen={onNextScreen} />] : []),
        <ConnectAIOnboardingScreen key={"connect-ai-screen"} onNextScreen={onNextScreen} />,
        ...(isUserNew && !shouldSkipInvite
            ? [<OnboardingScreen5 key={"invite-screen"} onNextScreen={onNextScreen} teamToInviteTo={teamToInviteTo}/>]
            : []),
        <LaunchHypertaskOnboardingScreen key={"launch-screen"} />,
    ];
    const screenCount = Screens.length

    useEffect(() => {
        if (currIdx > screenCount - 1) {
            setCurrIdx(Math.max(screenCount - 1, 0))
        }
    }, [screenCount, currIdx])

    // Resume the sequence at a named screen (e.g. returning from the tutorial to finish onboarding).
    useEffect(() => {
        if (resumeAppliedRef.current || !resumeKey) return
        const idx = Screens.findIndex((screen) => screen.key === resumeKey)
        if (idx >= 0) {
            resumeAppliedRef.current = true
            setCurrIdx(idx)
        }
    }, [resumeKey, Screens])
        
    return (
        <>
            <div
                className="flex-col mx-auto h-SVH-full flex items-center text-white-black"
                >
                {
                    <>
                        <div className={`${loaded?"scale-100 opacity-100":"scale-95 opacity-0"} min-h-[512px] max-w-[95vw] sm:max-w-[90vw] items-center flex flex-1 duration-200 ease-in-out `}>
                            {Screens[currIdx]}
                        </div>

                        <div className="flex gap-2">
                            {
                                Array.from({ length: screenCount }).map((_, idx) => (
                                    <span
                                        onClick={() => jumpToScreen(idx)}
                                        className={cn(
                                            "w-2 h-2 mb-3 rounded-full",
                                            currIdx === idx
                                                ? "bg-white-black"
                                                : "bg-active-elementBg"
                                        )}
                                        key={idx}
                                    />
                                ))
                            }
                        </div>
                    </>
                }
            </div>
        </>
    )
}

export default OnboardingPageComponent
