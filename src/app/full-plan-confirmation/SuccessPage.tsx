"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect } from "react";
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom, currentUserAtom } from "@/store";
import { useRouter } from "next/navigation";
import Stripe from "stripe";
import { parseCookies } from "nookies";
import axios from "axios";

const Success = ({
  subscription,
}: {
  subscription: Stripe.Subscription | undefined;
}) => {
  const [_currentProject, _] = useRecoilState(currentProjectAtom);
  const [currentUser, __] = useRecoilState(currentUserAtom);
  const router = useRouter();

  const onClickHandler = () => {
    if (_currentProject?.id) {
      router.push(`/project?id=${_currentProject?.id}`);
    } else {
      // Check for previousBoard cookie
      const cookies = parseCookies();
      const previousBoard = cookies.previousBoard;

      if (previousBoard) {
        const [projectId, view] = previousBoard.split("|&|");
        const projectIdNumber = projectId.split("-")[1];
        let redirectUrl = `/project?id=${projectIdNumber}`;

        if (view && view.length > 0 && view !== "undefined") {
          redirectUrl += `&view=${view}`;
        }

        router.push(redirectUrl);
      } else {
        // Fallback to onboarding if no project found
        router.push("/onboarding");
      }
    }
  };

  const checkSubscription = () => {
    console.log("🤔 ~ checkSubscription ~ subscription:", subscription)
    console.log("🤔 ~ checkSubscription ~ currentUser:", currentUser)
    if (subscription && currentUser) {
      var startDate = new Date(subscription.start_date);
      var currentDate = new Date();
      const isSameHour =
        startDate.getFullYear() === currentDate.getFullYear() &&
        startDate.getMonth() === currentDate.getMonth() &&
        startDate.getDate() === currentDate.getDate() &&
        startDate.getHours() === currentDate.getHours();

      axios.post("/api/stripe/event", { subscription });
    }
  };

  useEffect(() => checkSubscription(), []);

  return (
    <>
      <div className={`wlcm-page text-white h-[100svh] grid bg-[#27292D]`}>
        <main className="flex items-center min-w-[90vw] sm:min-w-[350px] max-w-[350px] sm:max-w-[520px] mx-auto my-auto">
          <div className="flex flex-col w-full items-center rounded-lg py-4 px-[28px] gap-5  sm:py-7 sm:px-20 justify-center  bg-inherit ">
            {/* <img src="/loginLogoMain.png" alt="logo" /> */}
            <div className="flex flex-col gap-3">
              <h1 className="text-subheading sm:text-display max-w-[500px] whitespace-nowrap  font-semibold">
                Thank You for Upgrading!
              </h1>
              <p className="text-center">
                If you have any questions or need support, please feel free to
                contact us via{" "}
                <a
                  className="font-bold hover:underline text-hypertasks-header-blue"
                  href="mailto:help@hypertask.ai"
                >
                  help@hypertask.ai
                </a>
              </p>
            </div>
            <div
              onClick={onClickHandler}
              className="py-2 w-full justify-center sm:w-fit px-16 sm:px-9 text-subheading bg-white text-black rounded-md flex items-center gap-3 cursor-pointer"
            >
              <span className="text-emphasis  font-semibold sm:text-emphasis whitespace-nowrap">
                Continue
              </span>
            </div>
          </div>
        </main>
      </div>
    </>
  );
};

export default Success;
