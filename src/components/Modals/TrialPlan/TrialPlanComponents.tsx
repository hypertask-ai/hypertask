import { IconsGlobal } from "@/components/Common/IconsGlobal";
import { getTeamById } from "@/lib/serverActions";
import { storeSubscriptionPlans } from "@/lib/subscriptionPlans";
import { CreateCheckoutParams, IPricingSearchParams } from "@/models/model";
import axios from "axios";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

interface IRowPerkTitle {
    AIPrefix?: boolean;
    content: string;
    showCheck?: boolean;
    checkVariant?: "black" | "gray" | "AI";
    type: "title" | "amount"
}
export const RowContent: React.FC<IRowPerkTitle> = ({ AIPrefix, content, checkVariant, showCheck, type }) => {

    return (
        <div className={`flex gap-2 lg:gap-3 pb-3  items-center ${type == "title" ? "font-medium" : "font-normal"} text-meta sm:text-content lg:text-emphasis`}>
            {AIPrefix && <span className="text-hypertasks-ai-purple">AI</span>}
            {
                showCheck && checkVariant ? (
                    checkVariant === "AI" ?
                        <IconsGlobal.Check variant="purple" className="font-bold" size={12} strokeWidth={1.6} />
                        :
                        checkVariant === "gray" ?
                            <IconsGlobal.Check variant="gray" className="font-bold" size={12} strokeWidth={1.3} />
                            :
                            <IconsGlobal.Check variant="black" className="font-bold" size={12} strokeWidth={1.3} />
                )
                    :
                    <></>
            }
            <span className={`${checkVariant && !showCheck && type == "amount" && "ml-5"} whitespace-nowrap`}>
                {content}
            </span>
        </div>
    )
}



export const TrialsButton = ({teamId}:{teamId:string}) => {
    const [selectedTime, setSelectedTime] = useState(0);
    const [teamInfo, setTeamInfo] = useState<IPricingSearchParams|undefined>(undefined);
    const [fetchingInfo, setFetching ] = useState(true)
    const CHECKOUT_SESSION_API_ENDPOINT = "/api/stripe/session/checkout";
    const router = useRouter()

    const createCheckout = async () => {
        if (
            !teamInfo    // hasSubscription.monthly && selectedTime==0 || hasSubscription.yearly&&selectedTime===1 
        ) {
            // router.push(manageLink)
        }
        else {
            // ================= POST request to create checkout sessioN
            const body: CreateCheckoutParams = {
                teamTitle: teamInfo.teamTitle,
                googleAccountId: teamInfo.googleAccountId,
                quantity: teamInfo.totalSeats,
                stripe_customer_id: teamInfo.stripe_customer_id,
                teamId: teamInfo.teamId,
                mode:"Trial",
                priceId: process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID!,
                returnUrl: `${process.env.NEXT_PUBLIC_BASEURL}/trial-page-confirmation`,
                cancelUrl: process.env.NEXT_PUBLIC_BASEURL

            };
            const url = await axios.post(CHECKOUT_SESSION_API_ENDPOINT, body);
            router.push(url.data.url)
        }
    };

    useEffect(()=>{
        let cancelled = false

        const fetchTeamInfo = async()=>{
            try {
                if (teamId){
                    const res = await getTeamById(teamId)
                    if (!res || !res.stripe_customer_id)throw "Team doesnt exist or doesn't have a stripe attached to it"
                    if (cancelled) return
                    setTeamInfo({
                        teamId:res.id,
                        googleAccountId:res.googleAccountId,
                        totalSeats:res.totalSeats,
                        teamTitle:res.title??"",
                        stripe_customer_id:res.stripe_customer_id,
                        hasCompletedTrial:res?.team_activity?.hasCompletedTrial
                    })
                }
            } catch (error) {
                if (!cancelled) console.log("🚀 ~ fetchTeamInfo ~ error:", error)
            }
            finally{
                if (!cancelled) setFetching(false)
            }
        }

        setFetching(true)
        fetchTeamInfo()
        return () => {
            cancelled = true
        }
    },[teamId])
    if (fetchingInfo){
        return (<p className="text-[#444444] text-content sm:text-emphasis dark:text-text-light-gray font-normal">Checking plan access…</p>)
    }
    if (teamInfo?.hasCompletedTrial){
        return (<p className="text-[#444444] text-content sm:text-emphasis dark:text-text-light-gray font-normal">You have already used your free trial</p>)
    }
    return (
        <>
            <div onClick={createCheckout} className="min-w-[280px] px-10 font-semibold text-content btn btn-dark">Start 14 Day Pro Trial</div>
        </>
    )
}


// refactor opportunity:
// some of them are reusable, please refactor them when you can.
// for example the sentences NOW use the same font, so might as well have same component for them to avoid inconsistency.

export const PlansTable = ()=>{
    return(
        <>
        <h2 className="text-4xl text-center sm:text-4xl font-semibold mb-2 sm:mb-0 lg:w-3/5 ">Try the Pro plan for free for 14 days</h2>
        <p className="font-medium  text-center text-content sm:text-emphasis text-text-light-gray lg:w-3/5">Use Hypertask as much as you want with no board or task amount limitations with unlimited AI. Risk free, cancel anytime.</p>
        <div className="py-2 sm:py-6 max-h-[58svh] max-w-[80vw] overflow-auto lg:scrollbar-none scrollbar-thin scrollbar-thumb-inherit scrollbar-track-inherit text-left font-semibold ">
                {/* ============ map any plan for now as we want to map elements against the length =============== */}
                <div className="flex xs:gap-3 lg:gap-8">

                    {/* column 1  */}
                    <div className="lg:px-4 xs:px-2 py-2">
                        <ColumnTitle content={""} />
                        <div className="flex flex-col font-bold">
                            {
                                storeSubscriptionPlans[0].perks.map((perk, index) =>
                                    <RowContent type="title" key={`perk-${index}`} AIPrefix={!!perk.titlePrefix} content={perk.title} />

                                )
                            }
                        </div>
                    </div>

                    {/* column 2  */}
                    <div className=" lg:px-4 xs:px-2 py-2">
                        <ColumnTitle content={"Starter"} />

                        <div className="flex flex-col">
                            {
                                storeSubscriptionPlans[1].perks.map((perk, index) =>
                                    <RowContent type="amount" key={`perk-amount-${index}`} checkVariant="gray" showCheck={perk.excludeCheck ? false : true} content={perk.amount} />



                                )
                            }
                        </div>
                    </div>
                    {/* column 3  */}
                    <div className="xs:px-3  lg:px-6  bg-[#F3F3F3] dark:bg-active-elementBg py-2">
                        <div className="flex gap-2 items-center font-bold">
                            <ColumnTitle content={"Pro with "} />
                            <span className="text-hypertasks-ai-purple text-heading min-h-[40px] mb-2">AI</span>
                        </div>

                        <div className="flex flex-col items-center">
                            {
                                storeSubscriptionPlans[0].perks.map((perk, index) =>
                                    <RowContent type="amount" key={`perk-amount-${index}`} showCheck={true} checkVariant={perk.titlePrefix ? "AI" : "black"} content={perk.amount} />


                                )
                            }
                        </div>
                    </div>
                </div>

            </div>
        </>
    )
}


const ColumnTitle = ({ content }: any) => {
    return (
        <span className="min-h-[40px] mb-2 block font-bold text-heading whitespace-nowrap" >{content}</span>
    )
}
