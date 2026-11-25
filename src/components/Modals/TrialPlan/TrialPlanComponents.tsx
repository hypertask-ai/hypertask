import { HTPR_7919_ALLOWANCE_PERCENT_FLAG } from "@/lib/flags/definitions/htpr-7919-allowance-percent";
import { HTPR_7686_FREE_PLAN_LIMITS_FLAG } from "@/lib/flags/definitions/htpr-7686-free-plan-limits";
import { HTPR_7922_UNLIMITED_FREE_BOARDS_FLAG } from "@/lib/flags/definitions/htpr-7922-unlimited-free-boards";
import { HTPR_7923_UNLIMITED_FREE_TICKETS_FLAG } from "@/lib/flags/definitions/htpr-7923-unlimited-free-tickets";
import { HTPR_7924_FREE_FILE_25MB_FLAG } from "@/lib/flags/definitions/htpr-7924-free-file-25mb";
import { IconsGlobal } from "@/components/Common/IconsGlobal";
import { HTPR_7686_FREE_PLAN_COPY_FLAG } from "@/lib/flags/definitions/htpr-7686-free-plan-copy";
import { subscriptionPlansFor, trialComparisonColumns, trialPlanBlurb } from "@/lib/subscriptionPlans";
import { StartPlanButton } from "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton";
import { useFlag } from "@/hooks/useFlag";
import React from "react";

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
    return <StartPlanButton teamId={teamId} />;
}

export const PlansTable = ()=>{
    const showCorrectedCopy = useFlag(HTPR_7686_FREE_PLAN_COPY_FLAG);
    const percentageAllowance = useFlag(HTPR_7919_ALLOWANCE_PERCENT_FLAG);
    const planLimits = useFlag(HTPR_7686_FREE_PLAN_LIMITS_FLAG);
    const unlimitedBoards = useFlag(HTPR_7922_UNLIMITED_FREE_BOARDS_FLAG);
    const unlimitedTickets = useFlag(HTPR_7923_UNLIMITED_FREE_TICKETS_FLAG);
    const raisedFileLimit = useFlag(HTPR_7924_FREE_FILE_25MB_FLAG);
    const entitlementFlags = {
        planLimits,
        unlimitedTickets,
        raisedFileLimit,
        unlimitedBoards: unlimitedBoards ? true : undefined,
    };
    const columns = trialComparisonColumns(showCorrectedCopy, showCorrectedCopy || percentageAllowance
        ? subscriptionPlansFor(entitlementFlags, percentageAllowance, showCorrectedCopy)
        : undefined);
    return(
        <>
        <h2 className="text-4xl text-center sm:text-4xl font-semibold mb-2 sm:mb-0 lg:w-3/5 ">Start a Hypertask plan</h2>
        <p className="font-medium  text-center text-content sm:text-emphasis text-text-light-gray lg:w-3/5">{trialPlanBlurb(useFlag(HTPR_7686_FREE_PLAN_COPY_FLAG))}</p>
        <div className="py-2 sm:py-6 max-h-[58svh] max-w-[80vw] overflow-auto lg:scrollbar-none scrollbar-thin scrollbar-thumb-inherit scrollbar-track-inherit text-left font-semibold ">
                <div className="flex xs:gap-3 lg:gap-8">
                    {useFlag(HTPR_7686_FREE_PLAN_COPY_FLAG) ? (
                    <>
                    {([
                        ["starter", columns.starter, false],
                        ["pro", columns.proWithAi, true],
                    ] as const).map(([key, perks, highlighted]) => (
                        <div key={key} className={highlighted ? "xs:px-3 lg:px-6 bg-[var(--bg-plan-highlight)] py-2" : "lg:px-4 xs:px-2 py-2"}>
                            <div className={highlighted ? "flex gap-2 items-center font-bold" : undefined}>
                                <ColumnTitle content={highlighted ? "Pro with " : "Starter"} />
                                {highlighted ? <span className="text-hypertasks-ai-purple text-heading min-h-[40px] mb-2">AI</span> : null}
                            </div>
                            <div className={`flex flex-col ${highlighted ? "items-center" : ""}`}>
                                {perks.map((perk, index) => (
                                    <div key={`${key}-${index}`}>
                                        <RowContent type="title" AIPrefix={!!perk.titlePrefix} content={perk.title} />
                                        <RowContent type="amount" checkVariant={highlighted ? (perk.titlePrefix ? "AI" : "black") : "gray"} showCheck={highlighted ? true : !perk.excludeCheck} content={perk.amount} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                    </>
                    ) : (
                    <>
                    <div className="lg:px-4 xs:px-2 py-2">
                        <ColumnTitle content={""} />
                        <div className="flex flex-col font-bold">
                            {
                                (columns.sharedTitles ?? []).map((perk, index) =>
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
                    <div className="xs:px-3 lg:px-6 bg-[var(--bg-plan-feature)] py-2">
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
