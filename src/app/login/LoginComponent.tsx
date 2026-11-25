"use client";

import LoadingSpinner1 from "@/components/LoadingSpinners/LoadingSpinner1";
import { useAuth } from "@/hooks/General/useAuth";
import { ibmPlexMono } from "@/lib/fonts/ibmPlexMono";
import { cn } from "@/utils/undoActions/helperFuncs";
import Image from "next/image";
import { Newsreader } from "next/font/google";
import { useSearchParams } from "next/navigation";
import { MouseEvent } from "react";
import LoginMinimal from "./Login-2-AB-test";
import { LoginMiddle } from "./LoginMiddle";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
  adjustFontFallback: false,
});

const plans = [
  {
    name: "Free",
    price: "$0",
    unit: "free forever",
    note: "",
    features: [
      "Collaborative boards, unlimited tasks",
      "Starter AI allowance on fast budget models",
      "CLI + MCP included",
      "Upgrade anytime for full AI power",
    ],
    cta: "Start for free",
    featured: false,
  },
  {
    name: "BYOK",
    price: "$8",
    unit: "per user / month",
    note: "$96 billed yearly",
    features: [
      "All AI features on your own keys",
      "Anthropic, OpenAI or OpenRouter",
      "Up to 50 team seats",
      "Email support",
    ],
    cta: "Get started",
    featured: false,
  },
  {
    name: "Pro",
    price: "$16",
    unit: "per user / month",
    note: "$192 billed yearly",
    features: [
      "Everything in BYOK",
      "AI included, no API keys to manage",
      "Runs on Hypertask’s managed models",
      "Priority support",
    ],
    cta: "Get started",
    featured: true,
  },
] as const;

const LoginComponent = ({ invite = false, boatDevModel = false, agentCodeSignIn = false }: { invite?: boolean; boatDevModel?: boolean; agentCodeSignIn?: boolean }) => {
  const searchParams = useSearchParams();
  const isMinimal = searchParams?.get("var") === "minimal";
  const { isAuthenticating } = useAuth();

  if (boatDevModel) {
    return (
      <main className="flex min-h-[100svh] flex-col bg-pageBackground text-white-black lg:flex-row">
        <header className="flex flex-col justify-between border-border-light-gray-thin p-6 lg:w-1/2 lg:border-r lg:p-16">
          <a href="https://hypertask.ai" className={cn(ibmPlexMono.className, "flex w-fit items-center gap-3 text-heading font-semibold")}>
            <Image src="/hypertask-glyph-white.png" alt="" width={32} height={32} className="h-8 w-8 invert dark:invert-0" priority />
            Hypertask
          </a>
          <div className="hidden max-w-[400px] lg:block">
            <p className="text-heading font-medium">One shared board.<br />People and agents, together.</p>
            <p className="mt-4 text-content text-text-light-gray">Work with your team and your agents, from whichever AI product you already use.</p>
          </div>
        </header>
        <section aria-label="Sign in" className="flex flex-1 items-center justify-center px-6 py-12 lg:min-h-[100svh] lg:px-12">
          <div className="flex w-full max-w-[400px] flex-col rounded-sm border border-border-light-gray-thin bg-cardBackground p-6 text-center sm:p-8">
            {isAuthenticating ? (
              <div className="flex items-center justify-center gap-3" aria-live="polite" aria-busy="true">
                <LoadingSpinner1 size={20} thickness={2} />
                <span className="text-content">Signing you in…</span>
              </div>
            ) : (
              <LoginMiddle invite={invite} serifClassName={newsreader.className} boatDevModel agentCodeSignIn={agentCodeSignIn} />
            )}
          </div>
        </section>
      </main>
    );
  }

  if (isMinimal) {
    return <LoginMinimal />;
  }

  const scrollToLogin = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById("login-top")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main className="min-h-[100svh] w-full bg-[#000000] text-white">
      <div
        id="login-top"
        className="flex h-[100svh] min-h-[620px] w-full overflow-hidden bg-[#000000]"
      >
        <section
          aria-label="Sign in"
          className="flex w-full min-w-0 flex-1 flex-col px-6 py-5 lg:px-10 lg:py-7"
        >
          <div className="flex items-center gap-2">
            <Image
              src="/hypertask-glyph-white.png"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7"
              priority
            />
            <span
              className={cn(
                ibmPlexMono.className,
                "text-[1.35rem] font-bold text-white",
              )}
            >
              Hypertask
            </span>
          </div>

          <div className="flex flex-1 items-center justify-center">
            <div className="login-modal flex w-full max-w-[400px] flex-col text-center">
              {isAuthenticating ? (
                <div
                  className="flex items-center justify-center gap-3 text-white"
                  aria-live="polite"
                  aria-busy="true"
                >
                  <LoadingSpinner1 size={20} thickness={2} />
                  <span className="text-[15px]">Signing you in…</span>
                </div>
              ) : (
                <LoginMiddle invite={invite} serifClassName={newsreader.className} />
              )}
            </div>
          </div>
        </section>
      </div>

      <section
        aria-label="What is Hypertask"
        className="border-t border-[#4c5362] px-6 py-24 text-center"
      >
        <span className="mb-[18px] block text-[11px] font-semibold tracking-[0.14em] text-[#8e9093]">
          WHAT IS HYPERTASK
        </span>
        <p
          className={cn(
            newsreader.className,
            "mx-auto mb-[18px] max-w-[640px] text-balance text-[clamp(1.75rem,2.6vw,2.5rem)] font-medium leading-[1.15] tracking-[-0.02em]",
          )}
        >
          The project management interface between humans and AI&nbsp;agents.
        </p>
        <p className="mx-auto max-w-[560px] text-pretty text-[15px] leading-[1.6] text-[#8e9093]">
          One shared board where your team and your agents work together, from
          whichever AI product you already use.
        </p>

        <div className="mx-auto mt-14 grid max-w-[1040px] grid-cols-1 gap-5 min-[801px]:grid-cols-2">
          <Image
            src="/login-app-light.png"
            alt="Hypertask board with command palette and AI chat, light theme"
            width={1365}
            height={1032}
            loading="lazy"
            className="h-auto w-full rounded-[14px] border border-[#4c5362]"
          />
          <Image
            src="/login-app-dark.png"
            alt="Hypertask board with command palette and AI chat, dark theme"
            width={1365}
            height={1032}
            loading="lazy"
            className="h-auto w-full rounded-[14px] border border-[#4c5362]"
          />
        </div>
      </section>

      <section aria-label="Pricing" className="border-t border-[#4c5362] px-6 py-24">
        <div className="mx-auto max-w-[1020px]">
          <h2
            className={cn(
              newsreader.className,
              "mb-2.5 text-center text-[clamp(1.75rem,2.6vw,2.5rem)] font-medium tracking-[-0.02em]",
            )}
          >
            Simple, per-seat pricing
          </h2>
          <p className="mb-12 text-center text-[15px] text-[#8e9093]">
            Free forever. Upgrade when your team needs more AI.
          </p>

          <div className="mx-auto grid max-w-[420px] grid-cols-1 gap-5 min-[901px]:max-w-none min-[901px]:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.name}
                className={cn(
                  "relative flex flex-col rounded-[14px] border border-[#4c5362] bg-[#2a2d34] px-[26px] py-7",
                  plan.featured && "border-[#8e9093]",
                )}
              >
                {plan.featured && (
                  <span className="absolute left-1/2 top-[-12px] -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1 text-[11px] font-semibold tracking-[0.06em] text-[#0e0e0e]">
                    Most popular
                  </span>
                )}
                <p className="mb-3.5 text-[15px] font-semibold">{plan.name}</p>
                <div
                  className={cn(
                    newsreader.className,
                    "text-[42px] font-medium leading-none tracking-[-0.02em]",
                  )}
                >
                  {plan.price}
                </div>
                <p className="mt-1.5 text-[13px] text-[#8e9093]">{plan.unit}</p>
                <p className="mt-0.5 min-h-[15px] text-[12px] text-[#8e9093]">
                  {plan.note}
                </p>
                <ul className="mb-[26px] mt-[22px] flex flex-col gap-2.5 text-[14px] leading-[1.45]">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-baseline gap-2.5 before:text-[12px] before:text-[#8e9093] before:content-['✓']">
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  href="#login-top"
                  onClick={scrollToLogin}
                  className={cn(
                    "mt-auto flex h-11 w-full items-center justify-center rounded-lg bg-[#333B47] text-[14px] font-medium text-white no-underline transition-colors duration-150 hover:bg-[#4f5766] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8e9093]",
                    plan.featured && "bg-white text-[#0e0e0e] hover:bg-[#e5e5e5]",
                  )}
                >
                  {plan.cta}
                </a>
              </article>
            ))}
          </div>

          <p className="mt-10 text-center text-[14px] text-[#8e9093]">
            Enterprise, SLAs &amp; custom contracts?{" "}
            <a
              href="https://hypertask.ai/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-white underline underline-offset-2"
            >
              Book a demo
            </a>
          </p>
        </div>
      </section>

      <style jsx>{`
        .login-modal {
          animation: login-rise 0.7s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        @keyframes login-rise {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .login-modal {
            animation: none;
          }
        }
      `}</style>
    </main>
  );
};

export default LoginComponent;
