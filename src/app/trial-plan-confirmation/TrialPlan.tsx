"use client";
import { IHasSubscriptionCheck, IPricingSearchParams } from "@/models/model";
import { storeSubscriptionPlans } from "@/lib/subscriptionPlans";
import TrialCard from "@/components/PageComponents/Trial/TrialCard";

const TrialPlan = ({
  manageLink,
  teamInfo,
  hasSub,
}: {
  teamInfo: IPricingSearchParams;
  manageLink: string;
  hasSub: IHasSubscriptionCheck;
}) => {
  return (
    <>
      <div
        className={`wlcm-page text-white-black h-[100svh] grid bg-[#27292D]`}
      >
        <main className="flex items-center min-w-[90vw] mx-auto my-auto">
          <div className="flex flex-col w-full items-center rounded-lg py-4 px-[28px] gap-5  sm:py-7 sm:px-20 justify-center  bg-inherit ">
            <h1 className="w-full sm:max-w-[500px] font-semibold sm:font-bold text-white text-display sm:text-display">
              Choose Trial Plan
            </h1>
            <TrialCard
              teamInfo={teamInfo}
              manageLink={manageLink}
              plan={storeSubscriptionPlans[0]}
              hasSubscription={hasSub}
            />
          </div>
        </main>
      </div>
    </>
  );
};

export default TrialPlan;
