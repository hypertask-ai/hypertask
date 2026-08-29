"use client";
/* eslint-disable @next/next/no-img-element */
import { useRecoilState } from "@/lib/state";
import { currentProjectAtom } from "@/store";
import { useRouter } from "next/navigation";
import { parseCookies } from "nookies";

const Success = () => {
  const [_currentProject, _] = useRecoilState(currentProjectAtom);
  const router = useRouter();

  const onClickHandler = () => {
    if (_currentProject?.id) {
      router.push(`/project?id=${_currentProject?.id}`);
    } else {
      // Check for previousBoard cookie
      const cookies = parseCookies();
      const previousBoard = cookies.previousBoard;
      
      if (previousBoard) {
        const [projectId, view] = previousBoard.split('|&|');
        const projectIdNumber = projectId.split('-')[1];
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

  return (
    <>
      <div
        className={`wlcm-page text-white-black h-[100svh] grid `}
      >
        <main className="flex items-center min-w-[90vw] sm:min-w-[350px] max-w-[350px] sm:max-w-[520px] mx-auto my-auto">
          <div className="flex flex-col w-full items-center rounded-lg py-4 px-[28px] gap-5  sm:py-7 sm:px-20 justify-center  bg-inherit ">
            {/* <img src="/loginLogoMain.png" alt="logo" /> */}
            <div className="flex flex-col gap-5">
              <h1 className="text-subheading sm:text-display max-w-[500px] whitespace-nowrap  font-semibold">
                Your Pro Plan trial is now active!
              </h1>
              <p className="text-center">
                You have 14 days to test all Hypertask Pro Features
              </p>
            </div>
            <div
              onClick={onClickHandler}
              className="py-2 w-full justify-center sm:w-fit px-16 sm:px-9 text-subheading bg-white-black text-white-black-inverted rounded-md flex items-center gap-3 cursor-pointer"
            >
              <span className="text-emphasis  font-semibold sm:text-emphasis whitespace-nowrap">
                Let&apos;s Go
              </span>
            </div>
          </div>
        </main>
      </div>
    </>
  );
};

export default Success;
