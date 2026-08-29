"use client";

import axios from "axios";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useRouter, useSearchParams } from "next/navigation";
import { CHECKOUT_SESSION_API_ENDPOINT } from "@/lib/constants/APIRouteConstants";
import { createCheckoutParam } from "@/lib/constants/constants";
import {
  STORE_PLAN_RANK,
  StorePlanKind,
  planKindFromStripePriceId,
} from "@/lib/planFromStripePriceId";
import {
  buildPricingCheckoutCancelUrl,
  buildPricingCheckoutSuccessUrl,
} from "@/lib/pricingCheckoutUrls";
import {
  ISubscriptionPlan,
  storeSubscriptionPlans,
} from "@/lib/subscriptionPlans";
import type { IPricingSearchParams } from "@/models/model";
import { cn } from "@/utils/undoActions/helperFuncs";
import {
  BillingActionRow,
  settingsActionButtonClass,
} from "./SettingsBillingRow";
import SettingsCard from "./SettingsCard";
import SettingsSectionShell from "./SettingsSectionShell";
import { getSettingsPath } from "./settingsNavigation";
import { useSettingsTeam } from "./useSettingsTeam";
import { useRecoilValue } from "@/lib/state";
import { currentUserAtom } from "@/store";

type BillingIntervalIndex = 0 | 1;

const PlansSection = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentUser = useRecoilValue(currentUserAtom);
  const { ownerAndMembers, refetchTeam, team } = useSettingsTeam();
  const isOwner = ownerAndMembers.owner?.id === currentUser?.id;
  const activeSubscription = team?.subscriptionPlan?.[0] ?? null;
  const activePlan = planKindFromStripePriceId(activeSubscription?.priceId);
  const currentPlan: StorePlanKind = team?.activeSubscriptionPlanId
    ? activePlan.storePlanId
    : "Free";
  const [billingIntervalIndex, setBillingIntervalIndex] =
    useState<BillingIntervalIndex>(() =>
      activePlan.billingInterval === "year" ? 1 : 0,
    );
  const [checkoutPlanId, setCheckoutPlanId] = useState<StorePlanKind | null>(
    null,
  );
  const [confirmFreePlan, setConfirmFreePlan] = useState(false);
  const [switchingToFree, setSwitchingToFree] = useState(false);

  const plans = useMemo(
    () =>
      [...storeSubscriptionPlans].sort(
        (left, right) => STORE_PLAN_RANK[left.id] - STORE_PLAN_RANK[right.id],
      ),
    [],
  );

  useEffect(() => {
    setBillingIntervalIndex(activePlan.billingInterval === "year" ? 1 : 0);
  }, [activePlan.billingInterval]);

  useEffect(() => {
    if (searchParams?.get("success") === "1") {
      toast.success("Payment successful");
    }
  }, [searchParams]);

  // Teams created via /api/teams/create have no stripe_customer_id (only the
  // onboarding path sets one). The old /pricing page provisioned it on load;
  // without this, checkout has no customer and upgrading is impossible.
  useEffect(() => {
    if (!isOwner || !team?.id || team.stripe_customer_id) return;
    let cancelled = false;
    axios
      .post("/api/stripe/ensure-customer", { teamId: team.id })
      .then(() => {
        if (!cancelled) refetchTeam();
      })
      .catch((error) => console.error("ensure-customer failed", error));
    return () => {
      cancelled = true;
    };
  }, [isOwner, team?.id, team?.stripe_customer_id, refetchTeam]);

  const pricingTeam = (): IPricingSearchParams | null => {
    if (!team?.id || !team.stripe_customer_id || !team.googleAccountId) {
      toast.error("No billing account");
      return null;
    }

    return {
      googleAccountId: team.googleAccountId,
      stripe_customer_id: team.stripe_customer_id,
      teamId: team.id,
      teamTitle: team.title,
      totalSeats: team.totalSeats,
    };
  };

  const createCheckout = async (
    plan: ISubscriptionPlan,
    selectedTime: BillingIntervalIndex,
  ) => {
    if (!isOwner) return;
    const teamInfo = pricingTeam();
    const priceId = plan.types[selectedTime]?.stripePriceId;
    if (!teamInfo || !priceId) return;

    setCheckoutPlanId(plan.id);
    try {
      const body = createCheckoutParam(
        teamInfo,
        plan,
        selectedTime,
        "Normal",
        buildPricingCheckoutSuccessUrl(teamInfo),
        buildPricingCheckoutCancelUrl(teamInfo),
      );
      const response = await axios.post<{ url: string }>(
        CHECKOUT_SESSION_API_ENDPOINT,
        body,
      );
      router.push(response.data.url);
    } catch (error) {
      console.error(error);
      toast.error("Could not open checkout");
      setCheckoutPlanId(null);
    }
  };

  const switchToFreePlan = async () => {
    if (!isOwner || !team?.stripe_customer_id) return;

    setSwitchingToFree(true);
    try {
      await axios.post("/api/stripe/cancelSubscription", {
        stripe_customer_id: team.stripe_customer_id,
      });
      setConfirmFreePlan(false);
      await refetchTeam();
      router.refresh();
      toast.success("Successfully switched to Free Plan");
    } catch (error) {
      console.error(error);
      toast.error("Could not switch to Free Plan");
    } finally {
      setSwitchingToFree(false);
    }
  };

  return (
    <SettingsSectionShell title="Plans">
      <SettingsCard title="Plans">
        <BillingActionRow
          action={
            <div
              aria-label="Billing interval"
              className="flex items-center gap-1"
              role="group"
            >
              <IntervalButton
                active={billingIntervalIndex === 0}
                onClick={() => setBillingIntervalIndex(0)}
              >
                Monthly
              </IntervalButton>
              <IntervalButton
                active={billingIntervalIndex === 1}
                onClick={() => setBillingIntervalIndex(1)}
              >
                Annually
              </IntervalButton>
            </div>
          }
          label="Billing interval"
        />

        {plans.map((plan) => {
          const selectedTime = plan.id === "Free" ? 0 : billingIntervalIndex;
          const selectedType = plan.types[selectedTime];
          const isCurrentTier = plan.id === currentPlan;
          const isCurrentInterval =
            plan.id === "Free" ||
            (selectedTime === 0 && activePlan.billingInterval === "month") ||
            (selectedTime === 1 && activePlan.billingInterval === "year");
          const isExactCurrentPlan = isCurrentTier && isCurrentInterval;
          const actionLabel = getPlanActionLabel(plan.id, currentPlan);

          return (
            <BillingActionRow
              action={
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <span className="min-w-0 text-right text-dense font-medium text-text-light-gray">
                    {selectedType.price} {selectedType.description}
                  </span>
                  {isCurrentTier && (
                    <span className="text-micro font-medium text-text-light-gray">
                      Current
                    </span>
                  )}
                  {isExactCurrentPlan && plan.id === "BYOK" && (
                    <button
                      className={settingsActionButtonClass}
                      onClick={() => router.push(getSettingsPath("apiKeys"))}
                      type="button"
                    >
                      API keys
                    </button>
                  )}
                  {!isExactCurrentPlan && (
                    <button
                      className={settingsActionButtonClass}
                      disabled={
                        !isOwner || checkoutPlanId !== null || switchingToFree
                      }
                      onClick={() => {
                        if (plan.id === "Free") {
                          setConfirmFreePlan(true);
                          return;
                        }
                        createCheckout(plan, selectedTime);
                      }}
                      type="button"
                    >
                      {!isOwner
                        ? "Owner only"
                        : checkoutPlanId === plan.id
                          ? "Opening"
                          : actionLabel}
                    </button>
                  )}
                </div>
              }
              key={plan.id}
              label={plan.name}
            />
          );
        })}

        {confirmFreePlan && (
          <div className="mt-2 flex flex-col gap-3 border-t border-border-light-gray-thin px-2 pt-4 text-dense text-white-black">
            {switchingToFree ? (
              <p className="font-medium text-text-light-gray">
                Switching to the Free Plan. Please wait.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <p className="font-semibold">
                    Are you sure you want to downgrade?
                  </p>
                  <p className="font-medium text-text-light-gray">
                    This will cancel your current plan immediately and switch
                    this team to the Free Plan.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className={settingsActionButtonClass}
                    onClick={() => setConfirmFreePlan(false)}
                    type="button"
                  >
                    Keep plan
                  </button>
                  <button
                    className={settingsActionButtonClass}
                    onClick={switchToFreePlan}
                    type="button"
                  >
                    Confirm
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </SettingsCard>
    </SettingsSectionShell>
  );
};

const IntervalButton = ({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) => (
  <button
    aria-pressed={active}
    className={cn(
      settingsActionButtonClass,
      active ? "bg-active-modal-element" : "text-text-light-gray",
    )}
    onClick={onClick}
    type="button"
  >
    {children}
  </button>
);

const getPlanActionLabel = (
  targetPlan: StorePlanKind,
  currentPlan: StorePlanKind,
) => {
  if (targetPlan === currentPlan) return "Switch";
  return STORE_PLAN_RANK[targetPlan] > STORE_PLAN_RANK[currentPlan]
    ? "Upgrade"
    : "Downgrade";
};

export default PlansSection;
