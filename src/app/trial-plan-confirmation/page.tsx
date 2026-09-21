import { Metadata } from "next";
import { requireServerCookieUser } from "@/lib/auth/serverUser";
import {
  checkTrialSuccess,
  createCustomerIfNull,
  findTeam,
  generateCustomerPortalLink,
  hasSubscription,
} from "@/lib/subscription";
import TrialPlan from "./TrialPlan";
import Success from "./SuccessPage";
import getUserById from "@/utils/controllers/users/getById";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Trial Plan",
};

export default async function Page(
  props: {
    searchParams: Promise<{
      googleAccountId: string;
      teamId: string;
      teamTitle: string;
      totalSeats: string;
      stripe_customer_id: string;
      session_id: string;
      success: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;

  const User = await requireServerCookieUser();
  const userFromDB = await getUserById(User.id)
  console.log("🚀 ~ userFromDB:", userFromDB)
  //this is causing a major issue
  // if (userFromDB?.status===200 && userFromDB.res.UserSetting?.trialStatus){
  //   let previousBoardString = cookieStore.get('previousBoard');
  //   let redirectUrl = '/' 
  //   if (previousBoardString){
  //     const previousBoard = previousBoardString.value.split('-')
  //     redirectUrl = `/project?id=${previousBoard[1]}`
  //   }
  //     console.log("🚀 ~ redirectUrl:", redirectUrl)
  //   redirect(redirectUrl)
  // } 
  var team: any;
  if (
    !User ||
    !User.accountId ||
    !searchParams.stripe_customer_id ||
    !searchParams.totalSeats ||
    !searchParams.googleAccountId
  ) {
    //if (!searchParams.session_id || !searchParams.success) redirect("/");

    team = await findTeam(User);
    console.log("🚀 ~ team:", team);
  }

  // HTPR-4358: createCustomerIfNull now throws on failure. This page stays
  // tolerant on purpose: a provisioning error must not replace the
  // post-checkout confirmation with a Next.js error page.
  try {
    await createCustomerIfNull(User.email!, searchParams.teamId ?? team.id);
  } catch (error) {
    console.error("trial-plan-confirmation: customer provisioning failed", error);
  }

  console.log("🚀 ~ session_id:", searchParams.session_id);
  const customerId = await checkTrialSuccess(searchParams.session_id as string);

  // check which subscriptions does that user have
  const hasSub = await hasSubscription(searchParams.teamId ?? team.id);
  console.log("🚀 ~ hasSub:", hasSub);

  const manageLink = await generateCustomerPortalLink(
    "" + (searchParams.stripe_customer_id ?? team.stripe_customer_id)
  );
  console.log("🚀 ~ manageLink:", manageLink);

  const teamInfo = {
    teamTitle: searchParams.teamTitle ?? team.title,
    teamId: searchParams.teamId ?? team.id,
    totalSeats: parseInt(searchParams.totalSeats ?? team.totalSeats),
    stripe_customer_id:
      searchParams.stripe_customer_id ?? team.stripe_customer_id,
    googleAccountId: searchParams.googleAccountId ?? team.googleAccountId,
  };

  if (manageLink && User?.stripe_customer_id && !searchParams.session_id && !searchParams.success)
    return (
      <TrialPlan teamInfo={teamInfo} manageLink={manageLink} hasSub={hasSub} />
    );
  else if (customerId === User.stripe_customer_id) return <Success />;
  else return <>Something Went Wrong</>;
}
