import { IconsGlobal } from "@/components/Common/IconsGlobal";
import { getTeamById } from "@/lib/serverActions";
import { HTPR_7686_FREE_PLAN_COPY_FLAG } from "@/lib/flags/definitions/htpr-7686-free-plan-copy";
import { trialComparisonColumns, trialPlanBlurb } from "@/lib/subscriptionPlans";
import { CreateCheckoutParams, IPricingSearchParams } from "@/models/model";
import { StartPlanButton, requestCheckout } from "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { HTPR_7551_START_PLAN_CHECKOUT_FLAG } from "@/lib/flags/keys";
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
    const startPlanEnabled = useFlag(HTPR_7551_START_PLAN_CHECKOUT_FLAG);
    const flagReady = useFlagReady(HTPR_7551_START_PLAN_CHECKOUT_FLAG);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [teamInfo, setTeamInfo] = useState<IPricingSearchParams|undefined>(undefined);
    const [fetchingInfo, setFetching ] = useState(true)

    const router = useRouter()

    const createCheckout = async () => {
        if (
            !teamInfo
        ) {
        }
        else {
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
            if (pending) return;
            setPending(true);
            setError(null);
            try {
                router.push(await requestCheckout(body));
            } catch {
                setError("Could not start checkout. Please try again.");
                setPending(false);
            }
        }
    };

    useEffect(()=>{
        let cancelled = false
        if (!flagReady || startPlanEnabled) return

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
    },[teamId, flagReady, startPlanEnabled])
    if (!flagReady) return null;
    if (startPlanEnabled) return <StartPlanButton teamId={teamId} />;
    if (fetchingInfo){
        return (<p className="text-[#444444] text-content sm:text-emphasis dark:text-text-light-gray font-normal">Checking plan access…</p>)
    }
    if (teamInfo?.hasCompletedTrial){
        return (<p className="text-[#444444] text-content sm:text-emphasis dark:text-text-light-gray font-normal">You have already used your free trial</p>)
    }
    return (
        <>
            <button type="button" disabled={pending || !teamInfo} onClick={createCheckout} className="min-w-[280px] px-10 font-semibold text-content btn btn-dark">{pending ? "Opening checkout…" : "Start 14 Day Pro Trial"}</button>
            {error && <p role="alert">{error}</p>}
        </>
    )
}

export const PlansTable = ()=>{
    const startPlanEnabled = useFlag(HTPR_7551_START_PLAN_CHECKOUT_FLAG);
    const flagReady = useFlagReady(HTPR_7551_START_PLAN_CHECKOUT_FLAG);
    const showCorrectedCopy = useFlag(HTPR_7686_FREE_PLAN_COPY_FLAG);
    const columns = trialComparisonColumns(showCorrectedCopy);
    return(
        <>
        <h2 className="text-4xl text-center sm:text-4xl font-semibold mb-2 sm:mb-0 lg:w-3/5 ">{!flagReady ? "Checking plan access…" : startPlanEnabled ? "Start a Hypertask plan" : "Try the Pro plan for free for 14 days"}</h2>
        <p className="font-medium  text-center text-content sm:text-emphasis text-text-light-gray lg:w-3/5">{trialPlanBlurb(showCorrectedCopy)}</p>
        <div className="py-2 sm:py-6 max-h-[58svh] max-w-[80vw] overflow-auto lg:scrollbar-none scrollbar-thin scrollbar-thumb-inherit scrollbar-track-inherit text-left font-semibold ">
                <div className="flex xs:gap-3 lg:gap-8">
                    {columns.sharedTitles ? (
                    <>
                    <div className="lg:px-4 xs:px-2 py-2">
                        <ColumnTitle content={""} />
                        <div className="flex flex-col font-bold">
                            {
                                columns.sharedTitles.map((perk, index) =>
                                    <RowContent type="title" key={`perk-${index}`} AIPrefix={!!perk.titlePrefix} content={perk.title} />

                                )
                            }
                        </div>
                    </div>

                    <div className=" lg:px-4 xs:px-2 py-2">
                        <ColumnTitle content={"Starter"} />

                        <div className="flex flex-col">
                            {
                                columns.starter.map((perk, index) =>
                                    <RowContent type="amount" key={`perk-amount-${index}`} checkVariant="gray" showCheck={perk.excludeCheck ? false : true} content={perk.amount} />



                                )
                            }
                        </div>
                    </div>
                    <div className="xs:px-3  lg:px-6  bg-[#F3F3F3] dark:bg-active-elementBg py-2">
                        <div className="flex gap-2 items-center font-bold">
                            <ColumnTitle content={"Pro with "} />
                            <span className="text-hypertasks-ai-purple text-heading min-h-[40px] mb-2">AI</span>
                        </div>

                        <div className="flex flex-col items-center">
                            {
                                columns.proWithAi.map((perk, index) =>
                                    <RowContent type="amount" key={`perk-amount-${index}`} showCheck={true} checkVariant={perk.titlePrefix ? "AI" : "black"} content={perk.amount} />


                                )
                            }
                        </div>
                    </div>
                    </>
                    ) : (
                    <>
                    <OwnPlanColumn perks={columns.starter} highlighted={false} />
                    <OwnPlanColumn perks={columns.proWithAi} highlighted />
                    </>
                    )}
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

const OwnPlanColumn = ({
    perks,
    highlighted,
}: {
    perks: { titlePrefix?: string; title: string; amount: string; excludeCheck?: boolean }[];
    highlighted: boolean;
}) => (
    <div className={highlighted ? "xs:px-3 lg:px-6 bg-[#F3F3F3] dark:bg-active-elementBg py-2" : "lg:px-4 xs:px-2 py-2"}>
        {highlighted ? (
            <div className="flex gap-2 items-center font-bold">
                <ColumnTitle content={"Pro with "} />
                <span className="text-hypertasks-ai-purple text-heading min-h-[40px] mb-2">AI</span>
            </div>
        ) : (
            <ColumnTitle content={"Starter"} />
        )}
        <div className={`flex flex-col ${highlighted ? "items-center" : ""}`}>
            {perks.map((perk, index) => (
                <div key={`perk-${index}`}>
                    <RowContent type="title" AIPrefix={!!perk.titlePrefix} content={perk.title} />
                    <RowContent
                        type="amount"
                        checkVariant={highlighted ? (perk.titlePrefix ? "AI" : "black") : "gray"}
                        showCheck={highlighted ? true : !perk.excludeCheck}
                        content={perk.amount}
                    />
                </div>
            ))}
        </div>
    </div>
);
