import { useRecoilState } from "@/lib/state";
import { currentProjectAtom,  currentUserAtom, } from "@/store";
import { LinkedSingleSectionContentTitle } from "./Single section items";
import { constructPricingPageUrl } from "@/utils/helperFunctions/helperFunctions";

const ManageAccountSection = () => {
    const [_currentProject, _] = useRecoilState(currentProjectAtom)
    const [currentUser, _setCurrentUser] = useRecoilState(currentUserAtom);

    return (
        <>
            {
                _currentProject?.team.googleAccount.userId === currentUser?.id&& _currentProject?.team.activeSubscriptionPlanId
                &&
                <>
                    <LinkedSingleSectionContentTitle
                        id="manage-subscriptions"
                        title="Manage subscription"
                        href={constructPricingPageUrl(_currentProject, "Upgrade")}
                    />
                    <LinkedSingleSectionContentTitle
                        id="manage-team-members"
                        title="Manage team members"
                        href={constructPricingPageUrl(_currentProject, "Members")}
                    />
                    <LinkedSingleSectionContentTitle
                        id="manage-billing"
                        title="Manage billing"
                        href={constructPricingPageUrl(_currentProject, "Billing")}
                    />
                    <LinkedSingleSectionContentTitle
                        id="team-settings"
                        title="Team settings"
                        href={constructPricingPageUrl(_currentProject, "Settings")}
                    />
                  
                </>

            }
        </>
    )
}

export default ManageAccountSection
