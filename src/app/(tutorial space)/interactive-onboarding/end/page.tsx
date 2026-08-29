'use client'
import LoginButton from "@/app/login/LoginButton";
import useDarkMode from "@/hooks/MultiPages/HTC/useDarkMode";
import useFunnelCookies from "@/hooks/MultiPages/useFunnelCookies";
import Image from "next/image";
import HTCLogo from "@/assets/HTC_without_text.png"
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const TutorialEndPage = () => {
  
  const searchParams = useSearchParams()


  // if user is coming from funnel this will become like a signup page, when a user from funnel completes his tutorial we show login button here
  // otherwise it will be a normal tutorial end page.
  if (searchParams?.get('funnel_completed') ) {
    return <FunnelCase />
  }

  // Normal tutorial end page for users who are not coming from funnel and completed their interactive tutorial.

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4 text-center"
    // style={{
    //   background:
    //     "linear-gradient(135deg, rgb(76, 81, 153) 0%, rgb(102, 82, 144) 100%)",
    // }}
    >
      <div className="space-y-4 max-w-2xl text-white-black">
        <h1 className="text-4xl md:text-6xl font-medium">
          <span className="block mb-2">Well Done!</span>
          <span className="block">All updates processed.</span>
        </h1>
        <p className="text-white-black text-opacity-90 text-subheading md:text-subheading">
          {"Your team's next milestone awaits. Let's keep the momentum going."}
        </p>
      </div>
      <div className="fixed bottom-8 text-white-black">
        Hit{" "}
        <span className="text-white-black-inverted font-medium px-2 py-1 rounded bg-white-black bg-opacity-70">
          enter
        </span>{" "}
        to experience Inbox Zero!
      </div>
    </div>
  );
};

export default TutorialEndPage;


const FunnelCase = () => {
  const { effectiveTheme } = useDarkMode()
  const { markTutorialCompleted } = useFunnelCookies()

  useEffect(() => {
    markTutorialCompleted()
  }, [])
  return (
    <div className="min-h-screen flex flex-col gap-6 items-center justify-center text-center ">

      <Image
        src={effectiveTheme ? (effectiveTheme !== "dark" ? HTCLogo.src : "/loginLogoMain.png") : "/loginLogoMain.png"}
        // className="my-4 px-6 h-[28px] w-auto "
        // style={{ objectFit: "contain" }}
        width={80}
        height={80}
        alt=""
      />
      <h1 className="text-heading sm:text-4xl font-bold">Let&apos;s get your team setup!</h1>
      <p className="font-normal">Hypertask will drastically speed up  your teams communcation</p>
      <LoginButton size="normal" />
    </div>
  )
}
