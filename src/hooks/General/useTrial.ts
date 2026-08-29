import { CHECKOUT_SESSION_API_ENDPOINT } from "@/lib/constants/APIRouteConstants";
import { createCheckoutParam } from "@/lib/constants/constants";
import { ISubscriptionPlan } from "@/lib/subscriptionPlans";
import {
  IHasSubscriptionCheck,
  IPricingSearchParams,
  IProject,
} from "@/models/model";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { constructTrialPageURL } from "@/utils/helperFunctions/helperFunctions";
import axios from "axios";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRecoilState } from "@/lib/state";

interface IProps {
  teamInfo: IPricingSearchParams;
  manageLink: string;
  plan: ISubscriptionPlan;
  hasSubscription: IHasSubscriptionCheck;
}

const useTrial = ({ teamInfo, manageLink, plan, hasSubscription }: IProps) => {
  const router = useRouter();
  const [currentProject, _] = useRecoilState(currentProjectAtom);
  const [currentUser, __] = useRecoilState(currentUserAtom);

  const [selectedTime, setSelectedTime] = useState(
    hasSubscription.activeBillingInterval === "year" ? 1 : 0
  );

  const handleDurationChange = (index: number) => {
    setSelectedTime(index);
  };

  const createCheckout = async () => {
    const isExactCurrent =
      plan.id === hasSubscription.activeStorePlan &&
      ((selectedTime === 0 && hasSubscription.activeBillingInterval === "month") ||
        (selectedTime === 1 && hasSubscription.activeBillingInterval === "year"));

    if (isExactCurrent) {
      router.push(manageLink);
    } else {
      const baseURL = String(process.env.NEXT_PUBLIC_BASEURL);
      var currProj: IProject | undefined;

      if (currentProject) currProj = currentProject;
      else currProj = await getProjects(currentUser.id);
      const success = `${baseURL}/trial-plan-confirmation?success=1&session_id={CHECKOUT_SESSION_ID}`;
      const cancel = constructTrialPageURL(currProj!);
      const body = createCheckoutParam(
        teamInfo,
        plan,
        selectedTime,
        "Trial",
        success,
        cancel,
      );
      console.log("🚀 ~ createCheckout ~ body:", body);
      const url = await axios.post(CHECKOUT_SESSION_API_ENDPOINT, body);
      router.push(url.data.url);
    }
  };

  const getProjects = async (userId: number) => {
    const response = await fetch(`/api/projects/getAll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: userId }),
    });
    if (response.ok) {
      const data: IProject[] = await response.json();
      return data[0];
    }
  };

  return { createCheckout, handleDurationChange, selectedTime };
};

export default useTrial;
