import { ModalContainerCustom } from "@/components/Common/CommonModalComponents";
import "@/styles/AttachmentView.scss";
import React, { useEffect, useRef, useState } from "react";
import { ModalHeader } from "reactstrap";
import Image from "next/image";
import { ITeam, IUser, type IPricingSearchParams } from "@/models/model";
import { CHECKOUT_SESSION_API_ENDPOINT } from "@/lib/constants/APIRouteConstants";
import axios from "axios";
import { useRouter } from "next/navigation";
import {
  ISubscriptionPlan,
  storeSubscriptionPlans,
} from "@/lib/subscriptionPlans";
import { ArrowRight, X } from "lucide-react";
import commandImageDark from "@/assets/rightSidebarHTCLogoDarkMode.svg";
import logo from "@/assets/RightSidebarLogo.webp";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";
import toast from "react-hot-toast";
import { checkFreemiumDuration } from "@/utils/helperFunctions/helperFunctions";


import TestimonialCarousel from "./TestimonialCarousel";
import { currentUserAtom } from "@/store";
import { useRecoilState } from "@/lib/state";
import { buildPricingCheckoutCancelUrl } from "@/lib/pricingCheckoutUrls";
import {
  getActiveAccountId,
  listAccounts,
  switchAccount,
  type SwitchAccount,
} from "@/lib/auth/accounts";

interface ITrialModal {
  currentUser: IUser | null;
  callback: () => void;
}

type TPlan = "Month" | "Year";
type TTier = "BYOK" | "Pro";
type TeamLookupResult =
  | { kind: "owned"; team: ITeam }
  | { kind: "member"; ownerName: string | null }
  | { kind: "none" }
  | { kind: "error" };

const proPlanDef = storeSubscriptionPlans.find((p) => p.id === "Pro")!;
const byokPlanDef = storeSubscriptionPlans.find((p) => p.id === "BYOK")!;

function teamToPricingParams(team: ITeam): IPricingSearchParams {
  return {
    teamTitle: team.title,
    teamId: team.id,
    totalSeats: team.totalSeats,
    stripe_customer_id: team.stripe_customer_id,
    googleAccountId: team.googleAccountId,
  };
}

const PaywallAccountSwitcher = () => {
  const [accounts, setAccounts] = useState<SwitchAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [switchingToken, setSwitchingToken] = useState<string | null>(null);
  const activeAccountId = getActiveAccountId();

  useEffect(() => {
    let alive = true;
    listAccounts().then((signedInAccounts) => {
      if (!alive) return;
      setAccounts(
        signedInAccounts.filter(
          (account) =>
            account.id !== activeAccountId && Boolean(account.sessionToken),
        ),
      );
    });

    return () => {
      alive = false;
    };
  }, [activeAccountId]);

  if (accounts.length === 0) return null;

  const handleSwitch = async (account: SwitchAccount) => {
    setSwitchingToken(account.sessionToken);
    const switched = await switchAccount(account.sessionToken);
    if (switched) return;

    setSwitchingToken(null);
    toast.error("Could not switch accounts. Please sign in again.");
  };

  return (
    <div className="relative text-content font-medium">
      <button
        className="rounded-[5px] px-2 py-1 text-gray-400 transition hover:bg-white/10 hover:text-white focus-visible:bg-white/10 focus-visible:outline-none"
        onClick={() => setOpen((isOpen) => !isOpen)}
        type="button"
      >
        Switch account
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-2 min-w-[220px] overflow-hidden rounded-[5px] bg-black py-1 shadow-customshadow-2">
          {accounts.map((account) => {
            const label = account.name ?? account.email ?? "Account";
            const isSwitching = switchingToken === account.sessionToken;

            return (
              <button
                className="flex w-full flex-col px-3 py-2 text-left transition hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none disabled:cursor-wait"
                disabled={Boolean(switchingToken)}
                key={account.sessionToken}
                onClick={() => void handleSwitch(account)}
                type="button"
              >
                <span className="max-w-[260px] truncate text-white">
                  {isSwitching ? "Switching…" : label}
                </span>
                {account.name && account.email && (
                  <span className="max-w-[260px] truncate text-meta font-normal text-gray-400">
                    {account.email}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

const PurchasePlanModal: React.FC<ITrialModal> = ({
  callback,
}) => {
  const [currentUser] = useRecoilState(currentUserAtom);
  const upgradeMode = checkFreemiumDuration(currentUser?.joinedAt!);
  const [currTeam, setCurrTeam] = useState<ITeam | undefined>(undefined);
  const provisioningRef = useRef<Promise<ITeam | null> | null>(null);

  const findTeam = async (): Promise<TeamLookupResult> => {
    if (!currentUser?.id) return { kind: "error" };

    try {
      const response = await axios.get<ITeam | null>(
        `/api/teams/getByUserId?userId=${currentUser.id}`,
      );
      if (response.data) {
        setCurrTeam(response.data);
        return { kind: "owned", team: response.data };
      }

      const memberships = await axios.post<ITeam[]>(
        "/api/teams/getAllMinimal",
        { userId: currentUser.id },
      );
      const memberTeam = Array.isArray(memberships.data)
        ? memberships.data[0]
        : undefined;
      if (!memberTeam) return { kind: "none" };

      let ownerName: string | null = null;
      try {
        const teamMembers = await axios.get<{ owner?: IUser }>(
          "/api/members/getAllTeamMembers",
          { params: { teamId: memberTeam.id } },
        );
        ownerName =
          teamMembers.data.owner?.displayName ??
          teamMembers.data.owner?.email ??
          null;
      } catch {
        // Membership is enough to prevent self-provisioning. The owner name is
        // optional context for the toast.
      }

      return { kind: "member", ownerName };
    } catch (error) {
      console.error("Could not resolve the paywall team:", error);
      return { kind: "error" };
    }
  };

  const ensureBillingCustomer = async (team: ITeam): Promise<ITeam> => {
    if (team.stripe_customer_id) return team;

    const response = await axios.post<{ stripe_customer_id: string | null }>(
      "/api/stripe/ensure-customer",
      { teamId: team.id },
    );
    if (!response.data.stripe_customer_id) {
      throw new Error("Billing account provisioning failed");
    }

    const teamWithCustomer = {
      ...team,
      stripe_customer_id: response.data.stripe_customer_id,
    };
    setCurrTeam(teamWithCustomer);
    return teamWithCustomer;
  };

  const provisionTeam = async (): Promise<ITeam | null> => {
    if (provisioningRef.current) return provisioningRef.current;
    if (!currentUser?.id) {
      toast.error("Could not find your account. Please sign in again.");
      return null;
    }

    const provision = async () => {
      try {
        const displayName =
          currentUser.displayName?.trim() ||
          currentUser.email?.split("@")[0] ||
          "My";
        const response = await axios.post<ITeam>("/api/teams/create", {
          userId: currentUser.id,
          teamTitle: `${displayName}'s Team`,
        });
        if (!response.data?.id) {
          throw new Error("Team creation returned no team");
        }

        setCurrTeam(response.data);
        return await ensureBillingCustomer(response.data);
      } catch (error) {
        console.error("Could not create a team from the paywall:", error);
        toast.error("Could not create your team. Please try again.");
        return null;
      } finally {
        provisioningRef.current = null;
      }
    };

    provisioningRef.current = provision();
    return provisioningRef.current;
  };

  const getCheckoutTeam = async (): Promise<ITeam | null> => {
    try {
      if (currTeam) return await ensureBillingCustomer(currTeam);

      const lookup = await findTeam();
      if (lookup.kind === "owned") {
        return await ensureBillingCustomer(lookup.team);
      }
      if (lookup.kind === "member") {
        const owner = lookup.ownerName ?? "your team owner";
        toast.error(
          `Only your team's owner can manage the plan — switch account or ask ${owner}.`,
        );
        return null;
      }
      if (lookup.kind === "error") {
        toast.error("Could not check your team. Please try again.");
        return null;
      }

      return await provisionTeam();
    } catch (error) {
      console.error("Could not prepare checkout:", error);
      toast.error("Could not prepare checkout. Please try again.");
      return null;
    }
  };

  useEffect(() => {
    void findTeam();
  }, [currentUser?.id]);

  return (
    <ModalContainerCustom
      fade={false}
      show={true}
      isOpen={true}
      id="trial-modal-v2"
      toggle={() => {}}
      shouldCloseOnClickOutside={false}
      contentClassName="h-full"
      fullScreen={true}
      className="!bg-gradient-dark border-none sm:w-full md:min-w-[900px] flex flex-col"
      
    >
      <ModalHeader className="!bg-black rounded-none border-b-0 h-[60px] pl-[24px] text-subheading font-bold [&>*:first-child]:w-full">
        <div className="flex justify-end items-center gap-3 w-full">
          <PaywallAccountSwitcher />
          {/* HTPR-4839: out-of-trial is the free tier now, so the plans are
              always closable. upgradeMode used to trap users behind a lone
              sign-out icon. */}
          <X size={18} strokeWidth={1.75}
            onClick={() => {
              callback();
            }}
            className="cursor-pointer "
            width={18}
            height={18}
          />
        </div>
      </ModalHeader>
      
      <div className="flex-1 ">
        <NewTrialBody
          getCheckoutTeam={getCheckoutTeam}
          callback={callback}
          upgradeMode={upgradeMode}
        />
      </div>
    </ModalContainerCustom>
  );
};

const NewTrialBody = ({
  getCheckoutTeam,
  callback,
  upgradeMode,
}: {
  getCheckoutTeam: () => Promise<ITeam | null>;
  callback: () => void;
  upgradeMode: boolean;
}) => {
  const [selectedPlan, setSelectedPlan] = useState<TPlan>("Year");
  const [selectedTier, setSelectedTier] = useState<TTier>("Pro");
  const [openingCheckout, setOpeningCheckout] = useState(false);
  const router = useRouter();
  const { effectiveTheme } = useDarkMode();

  const offerPlan: ISubscriptionPlan =
    selectedTier === "Pro" ? proPlanDef : byokPlanDef;
  const monthType = offerPlan.types[0];
  const yearType = offerPlan.types[1];

  const createCheckout = async () => {
    if (openingCheckout) return;
    setOpeningCheckout(true);

    try {
      const team = await getCheckoutTeam();
      if (!team?.id || !team.stripe_customer_id) return;

      const baseURL = String(process.env.NEXT_PUBLIC_BASEURL);
      const returnUrl = `${baseURL}/full-plan-confirmation?success=1&session_id={CHECKOUT_SESSION_ID}`;
      const pricingParams = teamToPricingParams(team);
      const cancel = buildPricingCheckoutCancelUrl(pricingParams);
      const typeIdx = selectedPlan === "Month" ? 0 : 1;
      const priceId = offerPlan.types[typeIdx]?.stripePriceId;
      if (!priceId) return;
      const body = {
        teamTitle: team.title,
        googleAccountId: team.googleAccountId,
        quantity: team.totalSeats,
        stripe_customer_id: team.stripe_customer_id,
        teamId: team.id,
        priceId,
        mode: "Normal" as const,
        returnUrl,
        cancelUrl: cancel,
      };
      const url = await axios.post(CHECKOUT_SESSION_API_ENDPOINT, body);
      router.push(url.data.url);
      callback();
    } catch (error) {
      console.error("Could not open checkout:", error);
      toast.error("Could not open checkout. Please try again.");
    } finally {
      setOpeningCheckout(false);
    }
  };

  const onSelected = (selected: TPlan) => {
    setSelectedPlan(selected);
  };

  return (
    <div className="h-full overflow-auto max-h-[100vh]  scrollbar-none flex md:flex-row flex-col-reverse">
      {/* Left Side - Testimonials Carousel */}
      <TestimonialCarousel upgradeMode={upgradeMode} />

      {/* Right Side - Pricing */}
      <div className="md:h-full w-full md:w-1/2 p-12 md:bg-gradient-dark flex flex-col justify-center ">
        <div className="text-center mb-12">
          <Image
            src={effectiveTheme !== "dark" ? commandImageDark : logo}
            alt="hypertask logo trial"
            className="mx-auto pb-6"
          />
          <h2 className="text-4xl font-bold text-white mb-6">Choose Your Plan</h2>
          <p className="text-subheading text-gray-400">
            {"Choose a plan to continue organizing your projects and collaborating with your team."}
          </p>
        </div>

        <div className="flex justify-center gap-2 mb-8">
          {(["BYOK", "Pro"] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setSelectedTier(tier)}
              className={`rounded-full px-5 py-2 text-content font-semibold transition-colors ${
                selectedTier === tier
                  ? "bg-purple-600 text-white"
                  : "bg-transparent text-gray-400 border-thin border-gray-600"
              }`}
            >
              {tier === "BYOK" ? "BYOK" : "Pro"}
            </button>
          ))}
        </div>

        <p className="text-center text-gray-400 text-content mb-4">
          {offerPlan.name}: {monthType.price} monthly · {yearType.price} yearly
        </p>

        <div className="space-y-6 max-w-md mx-auto w-full">
          <NewTrialCard
            plan="Month"
            priceDisplay={monthType.price}
            selected={selectedPlan}
            onClickCallBack={onSelected}
            description={monthType.description}
          />
          <NewTrialCard
            plan="Year"
            priceDisplay={yearType.price}
            selected={selectedPlan}
            onClickCallBack={onSelected}
            save={true}
            description={yearType.description}
          />
        </div>

        <div className="text-center mt-12">
          <button
            className="bg-white hover:bg-gray-100 text-black px-8 py-3 text-subheading font-bold rounded-xl flex items-center gap-3 mx-auto transition-colors duration-200"
            disabled={openingCheckout}
            onClick={createCheckout}
          >
            {openingCheckout ? "Opening…" : "Get Started"}{" "}
            <ArrowRight strokeWidth={1.75} size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

const NewTrialCard = ({
  plan,
  priceDisplay,
  selected,
  onClickCallBack,
  save = false,
  description,
}: {
  plan: TPlan;
  priceDisplay: string;
  selected: TPlan;
  onClickCallBack: (selected: TPlan) => void;
  save?: boolean;
  description: string;
}) => {
  const isSelected = selected === plan;

  return (
    <div
      className={`relative p-8 rounded-lg border-2 cursor-pointer transition-all duration-200 ${
        isSelected 
          ? "bg-white/5 scale-[1.02] border-purple-800" 
          : "bg-transparent  border-gray-600 hover:border-gray-500"
      }`}
      onClick={() => onClickCallBack(plan)}
    >
      {save && (
        <div className="absolute -top-3 right-6">
          <span className="bg-purple-700 text-white px-3 py-1 rounded-full text-content font-medium">YEARLY</span>
        </div>
      )}
      
      <div className="flex items-center justify-between">
        <div>
          <h3 className={`text-heading font-bold mb-2 text-white`}>
            {plan}ly
          </h3>
          <p className={`text-gray-400`}>
            {description}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-4xl font-bold text-white ${isSelected ? "" : ""}`}>
            {priceDisplay}
          </div>
        </div>
      </div>
    </div>
  );
};


export default PurchasePlanModal;
