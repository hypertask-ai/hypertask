import useCurrentUser from '@/hooks/General/useCurrentUserCheckFromCookies'
import { IProject } from '@/models/model'
import axios from 'axios'
import { useRouter, useSearchParams } from 'next/navigation'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import nookies from "nookies";
import { cn } from '@/utils/undoActions/helperFuncs'
import { companyRoleOptions, companySizeOptions } from '@/lib/constants/constants'
import { GetStartedButton } from '../GetStartedButton'

const CreateTeamOnboardingScreen = () => {
    const currentUser = useCurrentUser()
    const router = useRouter()
    const params = useSearchParams()

    const [teamTitle, setTeamTitle] = useState("")
    const [companySize, setCompanySize] = useState(companySizeOptions[0])
    const [companyRole, setCompanyRole] = useState(companyRoleOptions[0])
    const [loading, setLoading] = useState<boolean>(false);

    const customValidationCheck = async()=>{
        const trimmedTeamTitle = teamTitle.trim()
        if (!trimmedTeamTitle) {
            toast.error("Team name is required.")
            return
        }
        if (!currentUser?.id) {
            toast.error("User not found. Please refresh and try again.")
            return
        }

        setLoading(true)
        
        try {
            const body = {
                userId: currentUser.id,
                teamTitle: trimmedTeamTitle,
                companyRole,
                companySize
            }
            const response = await axios.post("/api/users/completeOnboardingStep1",body)
            console.log("🚀 ~ customValidationCheck ~ response:", response)
            if (response.status===200) {
                const createdTeam = response.data.response?.Team
                if (!createdTeam?.id) {
                    throw new Error("Team creation failed")
                }

                const prevBoard = await getProjects(currentUser.id)
                const invitedProjectId = params?.get("projectId")
                const onboardingParams = new URLSearchParams({
                    teamTitle: createdTeam.title || trimmedTeamTitle,
                    id: createdTeam.id,
                    companySize
                })

                if (invitedProjectId && invitedProjectId !== "undefined") {
                    onboardingParams.set("projectId", invitedProjectId)
                }

                router.replace(`/onboarding?${onboardingParams.toString()}`)

                if (prevBoard?.id) {
                    nookies.set(null, 'previousBoard', `project-${prevBoard.id}|&|${undefined}`,{
                        maxAge: 600 * 60 * 24 * 7, // 1 week
                        path: '/',
                    })
                }
            }
        } catch (error) {
            console.log("🚀 ~ customValidationCheck ~ error:", error)
            toast.error("Could not create your team. Please try again.")
        } finally {
            setLoading(false)
        }
    }
    const getProjects = async (userId:number) => {
        const response = await fetch(`/api/projects/getAll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userId})
        });
        if (response.ok) {
            const data: IProject[] = await response.json()
            // setAllProjects(data)
          return data[0]
    
          }
        }
    return (
        <div className="flex flex-col gap-4 items-center justify-center flex-1 px-4 sm:px-6">

            <span className='flex flex-col text-center items-center gap-2'>
                <h2 className="text-heading sm:text-display font-medium px-2">Set up your workspace</h2>
                <span className="font-normal max-w-[90%] sm:max-w-[70%] text-content sm:text-emphasis">Let&apos;s get you set up quickly so you can see how it works</span>
            </span>

            <div className='shadow-customshadow-2 p-3 sm:p-4 bg-comment-description rounded border-thin border-border-light-gray-thin flex flex-col gap-3 w-full max-w-sm sm:max-w-xl' >
                <div className='flex flex-col gap-2'>
                    <label className='text-content sm:text-emphasis font-medium' htmlFor='team-title-input'>Team name</label>
                    <input
                        id='team-title-input'
                        className='bg-active-list-element outline-none p-2 font-normal text-white-black rounded border-thin border-border-light-gray-thin'
                        onChange={(event) => setTeamTitle(event.target.value)}
                        value={teamTitle}
                        placeholder='Acme team'
                        required
                        disabled={loading}
                    />
                </div>
                <div className='flex flex-col gap-2'>
                    <span className='text-content sm:text-emphasis font-medium'>How large is your team?</span>
                        <ClickableOptions selected={companySize} callback={setCompanySize} key={'company-size-options'} options_={companySizeOptions}/>
                </div>
                <div className='flex flex-col gap-2'>
                    <span className='text-content sm:text-emphasis font-medium'>What is your role?</span>
                        <ClickableOptions selected={companyRole} callback={setCompanyRole} key={'company-role-options'} options_={companyRoleOptions}/>

                </div>
            </div>

            <GetStartedButton
                onClick={customValidationCheck}
                text={loading ? "Creating..." : "Continue"}
                disabled={loading}
            />
        </div>
    )
}

const ClickableOptions = ({
    options_,
    callback,
    selected
}: {
    options_: any[];
    selected: string;
    callback: React.Dispatch<React.SetStateAction<string>>;
}) => {
    return (
        <div className="flex flex-wrap gap-2">
            {options_.map((option) => (
                <button
                    key={option}
                    onClick={() => callback(option)}
                    className={cn(
                        "px-2 sm:px-3 py-2 rounded text-meta sm:text-content !border-thin border-border-light-gray-thin transition-all duration-200 font-medium flex-shrink-0 text-center leading-tight",
                        selected === option
                            ? "bg-white-black text-white-black-inverted border-hypertasks-purple shadow-md scale-105"
                            : "bg-white-black-inverted text-white-black hover:bg-white-black-inverted/80"
                    )}
                    type="button"
                >
                    {option}
                </button>
            ))}
        </div>
    );
};

export default CreateTeamOnboardingScreen
