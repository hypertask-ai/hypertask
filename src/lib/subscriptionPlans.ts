import { freePlanLimitLines, type FreePlanLimitFlags } from "@/lib/freePlanLimits";

export interface ISubscriptionPlan {
  id: "Free" | "AI" | "Pro" | "BYOK";
  name: string;
  types: {
    id: number;

    title: "Monthly" | "Annually";
    price: string;
    description: string;
    stripePriceId?: string;
  }[];
  perks: {
    titlePrefix?: string,
    title: string,
    amount: string,
    unlimited: boolean,
    excludeCheck?: boolean
  }[];

}
const prevMonthly1 = String(process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_01)
const prevYearly1 = String(process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_01)

const prevMonthly2 = String(process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_02)
const prevYearly2 = String(process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_02)


const monthly_byok_price_id = String(process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_BYOK)
const yearly_byok_price_id = String(process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_BYOK)
export const monthly_pro_price_id = String(process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_PRO)
export const yearly_pro_price_id = String(process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_PRO)

export const allMonthlyPrices = [prevMonthly1, prevMonthly2, monthly_byok_price_id, monthly_pro_price_id]
export const allYearlyPrices = [prevYearly1, prevYearly2, yearly_byok_price_id, yearly_pro_price_id]

const subscriptionPlanTemplates: ISubscriptionPlan[] = [
  {
    id: "BYOK",
    name: "BYOK",
    types: [
      {
        id: 0,
        title: "Monthly",
        price: "$10",
        description: "per user / month",
        stripePriceId: monthly_byok_price_id,

      },
      {
        id: 1,
        title: "Annually",
        price: "$96",
        description: "per user / year",
        stripePriceId: yearly_byok_price_id,

      }
    ],
    perks: [
      {
        titlePrefix: "AI",
        title: "Task Writer",
        amount: "Unlimited",
        unlimited: true,
      },
      {
        titlePrefix: "AI",
        title: "Inbox triage & writing assist",
        amount: "Unlimited",
        unlimited: true,
      },
      {
        titlePrefix: "AI",
        title: "Summaries & voice dictation",
        amount: "Unlimited",
        unlimited: true,
      },
      {
        title: "Team seats",
        amount: "Up to 50",
        unlimited: false,
      },
      {
        title: "CLI + MCP",
        amount: "Included",
        unlimited: true,
      },
      {
        title: "Shared workspace",
        amount: "From 2+ seats",
        unlimited: true,
      },
      {
        title: "LLM billing",
        amount: "Your API keys (Anthropic, OpenAI, OpenRouter)",
        unlimited: true,
      },
      {
        title: "Support",
        amount: "Email",
        unlimited: true,
      },


    ]
  },
  {
    id: "Pro",
    name: "Pro",
    types: [
      {
        id: 0,
        title: "Monthly",
        price: "$20",
        description: "per user / month",
        stripePriceId: monthly_pro_price_id,

      },
      {
        id: 1,
        title: "Annually",
        price: "$192",
        description: "per user / year",
        stripePriceId: yearly_pro_price_id,

      }
    ],
    perks: [
      {
        titlePrefix: "AI",
        title: "Task Writer",
        amount: "Unlimited",
        unlimited: true,
      },
      {
        titlePrefix: "AI",
        title: "Inbox triage & writing assist",
        amount: "Unlimited",
        unlimited: true,
      },
      {
        titlePrefix: "AI",
        title: "Summaries & voice dictation",
        amount: "Unlimited",
        unlimited: true,
      },
      {
        title: "Team seats",
        amount: "Up to 50",
        unlimited: false,
      },
      {
        title: "CLI + MCP",
        amount: "Included",
        unlimited: true,
      },
      {
        title: "Shared workspace",
        amount: "From 2+ seats",
        unlimited: true,
      },
      {
        title: "LLM billing",
        amount: "$15 of tokens / seat included (overage 1.2×)",
        unlimited: true,
      },
      {
        title: "Support",
        amount: "Priority",
        unlimited: true,
      },


    ]
  },
  {
    id: "Free",
    name: "Free",
    types: [
      {
        id: 0,
        title: "Monthly",
        price: "$0",
        description: "Free forever",
      }
    ],
    perks: [
      {
        titlePrefix: "AI",
        title: "Task Writer",
        amount: "Unlimited",
        unlimited: true,
      },
      {
        titlePrefix: "AI",
        title: "Inbox triage & writing assist",
        amount: "Unlimited",
        unlimited: true,
      },
      {
        titlePrefix: "AI",
        title: "Summaries & voice dictation",
        amount: "Unlimited",
        unlimited: true,
      },
      {
        title: "Members",
        amount: "Unlimited",
        unlimited: false,
      },
      {
        title: "CLI + MCP",
        amount: "Included",
        unlimited: true,
      },
      {
        title: "Shared workspace",
        amount: "From 2+ seats",
        unlimited: true,
      },
      {
        title: "LLM billing",
        amount: "Included during trial",
        unlimited: true,
      },
      {
        title: "Support",
        amount: "Email",
        unlimited: true,
      },
    ]
  },
];

const legacyFreePlan: FreePlanLimitFlags = { planLimits: false, unlimitedTickets: false };

function withFreeLimits(plan: ISubscriptionPlan, flags: FreePlanLimitFlags): ISubscriptionPlan {
  if (plan.id !== "Free") return plan;
  const membersIndex = plan.perks.findIndex((perk) => perk.title === "Members");
  const limitPerks = freePlanLimitLines(flags).map((line) => ({
    title: line.title,
    amount: line.amount,
    unlimited: line.amount === "Unlimited tickets" || line.amount === "Unlimited boards",
  }));
  const perks = [...plan.perks];
  perks.splice(Math.max(membersIndex, 0) + 1, 0, ...limitPerks);
  return { ...plan, perks };
}

export function subscriptionPlansFor(flags: FreePlanLimitFlags, percentageAllowance = false): ISubscriptionPlan[] {
  return subscriptionPlanTemplates.map((plan) => {
    const limitedPlan = withFreeLimits(plan, flags);
    if (!percentageAllowance || limitedPlan.id !== "Pro") return limitedPlan;
    return {
      ...limitedPlan,
      perks: limitedPlan.perks.map((perk) => perk.title === "LLM billing"
        ? { ...perk, amount: "Included AI; add your own key for more" }
        : perk),
    };
  });
}

export const storeSubscriptionPlans = subscriptionPlansFor(legacyFreePlan);

const productionTrialBlurb = "Use Hypertask as much as you want with no board or task amount limitations with unlimited AI. Risk free, cancel anytime.";

export function trialPlanBlurb(corrected: boolean): string {
  return corrected ? "Risk free, cancel anytime." : productionTrialBlurb;
}

export function trialComparisonColumns(corrected: boolean, plans: ISubscriptionPlan[] = storeSubscriptionPlans) {
  if (!corrected) {
    return {
      sharedTitles: plans[0].perks,
      starter: plans[1].perks,
      proWithAi: plans[0].perks,
    };
  }
  const starter = plans.find((plan) => plan.id === "BYOK") ?? plans[0];
  const pro = plans.find((plan) => plan.id === "Pro") ?? plans[1];
  return {
    sharedTitles: null,
    starter: starter.perks,
    proWithAi: pro.perks.filter((perk) => !perk.amount.includes("$15 of tokens")),
  };
}
