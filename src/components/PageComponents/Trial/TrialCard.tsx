import { TeamStartPlanButton } from "@/components/PageComponents/Kanban/HeaderComponents/StartPlanButton";
import { ISubscriptionPlan } from "@/lib/subscriptionPlans";
import { IHasSubscriptionCheck, IPricingSearchParams } from "@/models/model";

interface IProps {
  teamInfo: IPricingSearchParams;
  manageLink: string;
  plan: ISubscriptionPlan;
  hasSubscription: IHasSubscriptionCheck;
}

const TrialCard = ({ teamInfo }: IProps) => {
  return <TeamStartPlanButton teamId={teamInfo.teamId} />;
};

export default TrialCard;
