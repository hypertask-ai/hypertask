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
//old price ids
const prevMonthly1 = String(process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_01)
const prevYearly1 = String(process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_01)

const prevMonthly2 = String(process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_02)
const prevYearly2 = String(process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_02)

// export const monthlyPriceId = String(process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID)
// export const yearlyPriceId = String(process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID)

const monthly_byok_price_id = String(process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_BYOK)
const yearly_byok_price_id = String(process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_BYOK)
export const monthly_pro_price_id = String(process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID_PRO)
export const yearly_pro_price_id = String(process.env.NEXT_PUBLIC_STRIPE_YEARLY_PRICE_ID_PRO)

export const allMonthlyPrices = [prevMonthly1, prevMonthly2, monthly_byok_price_id, monthly_pro_price_id]
export const allYearlyPrices = [prevYearly1, prevYearly2, yearly_byok_price_id, yearly_pro_price_id]

export const storeSubscriptionPlans: ISubscriptionPlan[] = [
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
    name: "Free Trial",
    types: [
      {
        id: 0,
        title: "Monthly",
        price: "$0",
        description: "/ 14 days",
        // stripePriceId: process.env.NEXT_PUBLIC_STRIPE_MONTHLY_PRICE_ID ?? "",

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
