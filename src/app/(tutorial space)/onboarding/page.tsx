import OnboardingPageComponent from "@/components/PageComponents/Onboarding/OnboardingPageComponent"
import { requireServerCookieUser } from "@/lib/auth/serverUser";
import { checkIfUserIsNew } from "@/lib/serverActions";
import { Metadata } from "next"

export const metadata: Metadata = {
    title: "Onboarding"
  }
   
export default async function Page(
    props:{
        searchParams: Promise<any>
    }
) {
    const searchParams = await props.searchParams;

    const teamToInviteTo ={
        title:searchParams.teamTitle,
        id:searchParams.id
    }
    const user = await requireServerCookieUser();
    const isUserNew = await checkIfUserIsNew(user.id)

    return (
        <OnboardingPageComponent isUserNew={isUserNew} teamToInviteTo={teamToInviteTo}/>
    )
}

