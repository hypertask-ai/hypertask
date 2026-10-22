import { useRecoilValue } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useGetAllAccessibleBoardList } from "@/hooks/MultiPages/useGetAllAccessibleBoardList";
import { StartPlanButton } from "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton";
import { useFlag, useFlagReady } from "@/hooks/useFlag";
import { HTPR_7551_START_PLAN_CHECKOUT_FLAG } from "@/lib/flags/definitions/htpr-7551-start-plan-checkout";
import useTrial from "@/hooks/General/useTrial";
import { ISubscriptionPlan } from "@/lib/subscriptionPlans";
import { IHasSubscriptionCheck, IPricingSearchParams } from "@/models/model";
import AILogo from "@/assets/AILogo.png";
import Image from "next/image";

interface IProps {
  teamInfo: IPricingSearchParams;
  manageLink: string;
  plan: ISubscriptionPlan;
  hasSubscription: IHasSubscriptionCheck;
}

const TrialCard = ({ teamInfo, manageLink, plan, hasSubscription }: IProps) => {
  const currentProject = useRecoilValue(currentProjectAtom);
  const currentUser = useRecoilValue(currentUserAtom);
  const startPlanEnabled = useFlag(HTPR_7551_START_PLAN_CHECKOUT_FLAG);
  const flagReady = useFlagReady(HTPR_7551_START_PLAN_CHECKOUT_FLAG);
  const selectedTeamBoard = currentProject?.team?.id === teamInfo.teamId && currentProject.id
    ? currentProject : undefined;
  const boards = useGetAllAccessibleBoardList(currentUser, {
    enabled: flagReady && startPlanEnabled && !selectedTeamBoard,
  });
  const checkoutBoard = selectedTeamBoard ?? boards.data?.find((board) =>
    board.id && board.team?.id === teamInfo.teamId);

  const { selectedTime, createCheckout, handleDurationChange } = useTrial({
    teamInfo,
    manageLink,
    plan,
    hasSubscription,
  });

  if (!flagReady) return null;
  if (startPlanEnabled) {
    if (checkoutBoard) return <StartPlanButton project={checkoutBoard} teamId={teamInfo.teamId} />;
    if (boards.isError) return <div role="status">Could not load this team's boards. <button type="button" onClick={() => void boards.refetch()}>Retry</button></div>;
    return <span role="status">{boards.isLoading ? "Loading this team's boards…" : "Open a board in this team to start a plan"}</span>;
  }

  return (
    <>
      <div className="w-full sm:max-w-[500px] font-semibold text-white ">
        <div className="flex items-center justify-between">
          {plan.id === "AI" ? (
            <div className="flex gap-2 items-center font-bold">
              <h1 className="text-display sm:text-display">Pro with </h1>
              <h1 className="text-hypertasks-ai-purple text-display sm:text-display">AI</h1>
              <Image
                className="mt-[2px]"
                height={24}
                width={24}
                src={AILogo.src}
                alt="ai"
              />
            </div>
          ) : (
            <h1 className="text-display sm:text-display">{plan.name}</h1>
          )}

          {plan.id === "AI" &&
            plan.types[selectedTime].title === "Annually" && (
              <span className="bg-[#4b4f55] h-fit px-1 ml-2 rounded-[3px] text-content sm:text-subheading">
                - 20%
              </span>
            )}
        </div>
        <div className="flex items-center justify-between my-[9px]">
          <span className="text-display sm:text-display">{plan.types[selectedTime].price}</span>
          <span className="text-content sm:text-subheading text-[#777C85] ">
            {plan.types[selectedTime].description}
          </span>
        </div>
        <div
                  className={`text-emphasis sm:text-heading cursor-pointer text-center rounded-md py-2
                  ${
                    hasSubscription.monthly ||
                    hasSubscription.yearly ||
                    hasSubscription.activeStorePlan !== "Free"
                      ? " border-[1px] text-[#777C85] border-[#363A40] bg-transparent"
                      : "bg-[#4455BB]"
                  }
                `}
          onClick={createCheckout}
        >
          Begin Hypertask Trial
        </div>

        {plan.id === "AI" && (
          <div className="flex rounded-full justify bg-[#363A40] mt-[15px] transition-all duration-100 ">
            {plan.types.map((item, index) => (
              <div
                onClick={() => handleDurationChange(index)}
                key={index}
                className={`cursor-pointer rounded-full transition-all ease-in duration-100  text-content sm:text-subheading w-full text-center mt-1 py-1 ${
                  selectedTime === index
                    ? "bg-white text-black"
                    : "bg-transparent text-[#777C85]"
                }`}
              >
                {item.title}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
};

export default TrialCard;
