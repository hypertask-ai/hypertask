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
  const { selectedTime, createCheckout, handleDurationChange } = useTrial({
    teamInfo,
    manageLink,
    plan,
    hasSubscription,
  });

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
        {/* ================ price and period ================ */}
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

        {/*-------------------- SWTICH BETWEEN PLANS -------------------- */}
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
