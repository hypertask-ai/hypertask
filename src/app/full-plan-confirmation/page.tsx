import { Metadata } from "next";
import Success from "./SuccessPage";
import { checkSubscriptionPlan } from "@/lib/subscription";

export const metadata: Metadata = {
  title: "Upgradation successful!",
};

export default async function Page(
  props: {
    searchParams: Promise<{
      session_id: string;
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const subscription = await checkSubscriptionPlan(
    searchParams.session_id as string
  );

  return <Success subscription={subscription} />;
}
